/* ============================================================
 * .eml（RFC 822 / MIME 邮件）解析 —— 只在浏览器里做展示用
 *
 * 目标：把一封邮件拆成「邮件头 + 可读正文 + 附件清单」，不追求完整实现
 * MIME 规范。覆盖常见情况：
 *   - 头部折行（continuation lines）
 *   - RFC 2047 编码字（=?UTF-8?B?...?= / =?UTF-8?Q?...?=）
 *   - multipart/*（含嵌套）、boundary
 *   - Content-Transfer-Encoding: base64 / quoted-printable
 *   - charset（按声明的字符集解码，失败退回 UTF-8）
 *
 * 纯函数、无 DOM 依赖，方便单独跑测试。正文 HTML 由 preview.ts 放进
 * 沙箱 iframe 渲染（脚本 / 外部请求都会被 CSP 与 sandbox 挡掉）。
 * ============================================================ */

export interface EmlAttachment {
  name: string;
  type: string;
  /** 解码后的字节数 */
  size: number;
}

export interface EmlPreview {
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  /** 优先展示的纯文本正文（可能为空） */
  text: string;
  /** 没有纯文本时用 HTML 正文（可能为空） */
  html: string;
  attachments: EmlAttachment[];
}

const MAX_DEPTH = 6;
const MAX_PARTS = 200;

/** 统一换行，避免 \r\n / \r 混用导致头部/正文切分错位 */
function norm(s: string): string {
  return String(s || '').replace(/\r\n?/g, '\n');
}

function toBytes(b64: string): Uint8Array {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 按声明字符集解码；不认识的字符集退回 UTF-8 */
function decodeBytes(bytes: Uint8Array, charset?: string): string {
  const cs = String(charset || 'utf-8').trim() || 'utf-8';
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return '';
    }
  }
}

/** quoted-printable → 字节（处理软换行 =\n 与 =XX） */
function qpToBytes(s: string): Uint8Array {
  const src = String(s || '').replace(/=\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 0x3d && i + 2 < src.length) {
      const hex = src.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    out.push(src.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}

/** 按 Content-Transfer-Encoding 解码，返回文本与字节数 */
function decodeTransfer(enc: string, body: string, charset?: string): { text: string; bytes: number } {
  const e = String(enc || '').trim().toLowerCase();
  if (e === 'base64') {
    const bytes = toBytes(body);
    return { text: decodeBytes(bytes, charset), bytes: bytes.length };
  }
  if (e === 'quoted-printable') {
    const bytes = qpToBytes(body);
    return { text: decodeBytes(bytes, charset), bytes: bytes.length };
  }
  // 7bit / 8bit / binary：文件整体已按 UTF-8 解过（FileViewer 读文本时）
  return { text: body, bytes: new TextEncoder().encode(body).length };
}

/** RFC 2047 编码字解码；相邻编码字之间的空白按规范去掉 */
function decodeMimeWords(s: string): string {
  return String(s || '')
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (all, charset: string, enc: string, data: string) => {
      try {
        const cs = String(charset || 'utf-8').split('*')[0] || 'utf-8';
        if (String(enc).toLowerCase() === 'b') {
          return decodeBytes(toBytes(data), cs);
        }
        // Q 编码里下划线代表空格
        const bytes = qpToBytes(String(data).replace(/_/g, ' '));
        return decodeBytes(bytes, cs);
      } catch {
        return all;
      }
    });
}

/** 解析 `; key=value; key="value"` 形式的头部参数 */
function headerParams(v: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /;\s*([^\s=;]+)\s*=\s*(?:"([^"]*)"|([^;]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(v || ''))) !== null) {
    out[m[1].toLowerCase()] = (m[2] !== undefined ? m[2] : m[3]).trim();
  }
  return out;
}

/** 拆头部 / 正文；头部按折行规则合并 */
function splitHeaders(src: string): { headers: Record<string, string>; body: string } {
  const s = norm(src);
  const idx = s.indexOf('\n\n');
  const headBlock = idx === -1 ? s : s.slice(0, idx);
  const body = idx === -1 ? '' : s.slice(idx + 2);
  const headers: Record<string, string> = {};
  let last = '';
  for (const line of headBlock.split('\n')) {
    if (/^[ \t]/.test(line) && last) {
      headers[last] += ' ' + line.trim();
      continue;
    }
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) {
      last = '';
      continue;
    }
    const key = m[1].trim().toLowerCase();
    headers[key] = headers[key] ? headers[key] + ', ' + m[2] : m[2];
    last = key;
  }
  return { headers, body };
}

/** 递归解析一个 MIME part */
function parsePart(
  headers: Record<string, string>,
  body: string,
  acc: EmlPreview,
  depth: number,
  budget: { n: number }
): void {
  if (depth > MAX_DEPTH || budget.n-- <= 0) return;

  const ctRaw = headers['content-type'] || 'text/plain; charset=us-ascii';
  const ct = ctRaw.split(';')[0].trim().toLowerCase();
  const params = headerParams(ctRaw);
  const enc = headers['content-transfer-encoding'] || '';
  const disp = headers['content-disposition'] || '';
  const dispType = disp.split(';')[0].trim().toLowerCase();
  const dispParams = headerParams(disp);
  const name = decodeMimeWords(dispParams['filename'] || params['name'] || '');

  // multipart：按 boundary 切片后递归
  if (ct.startsWith('multipart/') && params['boundary']) {
    const boundary = params['boundary'];
    const parts = body.split('--' + boundary);
    for (let i = 1; i < parts.length; i++) {
      let part = parts[i];
      if (part.startsWith('--')) break; // 结束边界
      part = part.replace(/^\n/, '');
      const { headers: ph, body: pb } = splitHeaders(part);
      parsePart(ph, pb, acc, depth + 1, budget);
    }
    return;
  }

  const decoded = decodeTransfer(enc, body, params['charset']);

  // 附件：显式 attachment，或带文件名却不是文本
  const isAttachment = dispType === 'attachment' || (!!name && !ct.startsWith('text/'));
  if (isAttachment) {
    acc.attachments.push({
      name: name || 'part-' + (acc.attachments.length + 1),
      type: ct || 'application/octet-stream',
      size: decoded.bytes
    });
    return;
  }

  if (ct === 'text/plain' && !acc.text) {
    acc.text = decoded.text;
    return;
  }
  if (ct === 'text/html' && !acc.html) {
    acc.html = decoded.text;
    return;
  }
  if (ct.startsWith('text/') && !acc.text) {
    acc.text = decoded.text;
    return;
  }
  // 其它（图片、日历、内嵌资源等）先按附件列出，至少让人知道有这些内容
  acc.attachments.push({
    name: name || 'part-' + (acc.attachments.length + 1),
    type: ct || 'application/octet-stream',
    size: decoded.bytes
  });
}

/** 是否像一封 .eml 邮件（用于内容兜底识别，文件后缀判断在调用方） */
export function looksLikeEml(text: string): boolean {
  const head = String(text || '').slice(0, 4096);
  if (!head) return false;
  let hits = 0;
  for (const re of [/^mime-version:/im, /^from:/im, /^to:/im, /^subject:/im, /^date:/im, /^content-type:/im]) {
    if (re.test(head)) hits++;
  }
  return hits >= 3;
}

/** 解析一封邮件；任何异常都降级为空结果，不阻断查看 */
export function parseEml(src: string): EmlPreview {
  const out: EmlPreview = { subject: '', from: '', to: '', cc: '', date: '', text: '', html: '', attachments: [] };
  try {
    const { headers, body } = splitHeaders(norm(src));
    const d = (k: string): string => decodeMimeWords(headers[k] || '');
    out.subject = d('subject');
    out.from = d('from');
    out.to = d('to');
    out.cc = d('cc');
    out.date = d('date');
    parsePart(headers, body, out, 0, { n: MAX_PARTS });
  } catch {
    // 解析失败就保留已拿到的部分，正文为空时 UI 会显示「无正文」
  }
  return out;
}
