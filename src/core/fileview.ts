/* ============================================================
 * 文件查看：判断「文本 / 二进制」并生成可展示的内容
 *
 * 判定一律**看内容（读文件头）**，不看文件后缀名——后缀可以随便改、也常常缺失，
 * 内容不会骗人：
 *   1) 命中常见二进制魔数 → 二进制
 *   2) 有 NUL 字节 → 二进制（文本文件里不该出现 NUL）
 *   3) 控制字符占比过高 → 二进制
 * 其余按文本处理（UTF-8，带 BOM 时按声明编码解）。
 *
 * 语言（高亮用）同样从内容推断：shebang、XML/JSON/PHP 开头、关键字等，
 * **认不出来就返回 null**（按纯文本显示），不做「猜」——猜错的高亮比不高亮更糟。
 * ============================================================ */

/** 可查看的体积上限（两种查看器共用）：超过就只提供下载 */
export const MAX_VIEW_BYTES = 2 * 1024 * 1024;

/** 查看器要看的文件（聊天页 / 群管理页 / 管理面板共用）。url 可以是 /uploads/xxx 或绝对地址 */
export interface FileViewTarget {
  url: string;
  name?: string;
  size?: number | null;
}

/** 超过这个体积不做语法高亮（hljs 在大文件上会阻塞界面好几秒） */
export const MAX_HIGHLIGHT_BYTES = 512 * 1024;

/** 单行超过这么多字符不做高亮（长行会让高亮器退化，且高亮结果也没意义） */
export const MAX_HIGHLIGHT_LINE = 5000;

/**
 * 手动选择高亮语言时的候选表（自动识别认错/认不出时用）。
 * 只列 highlight.js common 打包里**确实有**的那些，显示名用大家认识的样子
 * （xml 标成 HTML/XML 而不是 xml，否则没人知道那是什么）。
 */
export const HIGHLIGHT_LANGS: { code: string; label: string }[] = [
  { code: 'bash', label: 'Bash' },
  { code: 'c', label: 'C' },
  { code: 'cpp', label: 'C++' },
  { code: 'csharp', label: 'C#' },
  { code: 'css', label: 'CSS' },
  { code: 'diff', label: 'Diff' },
  { code: 'go', label: 'Go' },
  { code: 'graphql', label: 'GraphQL' },
  { code: 'ini', label: 'INI' },
  { code: 'java', label: 'Java' },
  { code: 'javascript', label: 'JavaScript' },
  { code: 'json', label: 'JSON' },
  { code: 'kotlin', label: 'Kotlin' },
  { code: 'less', label: 'Less' },
  { code: 'lua', label: 'Lua' },
  { code: 'makefile', label: 'Makefile' },
  { code: 'markdown', label: 'Markdown' },
  { code: 'objectivec', label: 'Objective-C' },
  { code: 'perl', label: 'Perl' },
  { code: 'php', label: 'PHP' },
  { code: 'python', label: 'Python' },
  { code: 'r', label: 'R' },
  { code: 'ruby', label: 'Ruby' },
  { code: 'rust', label: 'Rust' },
  { code: 'scss', label: 'SCSS' },
  { code: 'shell', label: 'Shell' },
  { code: 'sql', label: 'SQL' },
  { code: 'swift', label: 'Swift' },
  { code: 'typescript', label: 'TypeScript' },
  { code: 'xml', label: 'HTML/XML' },
  { code: 'yaml', label: 'YAML' }
];

/** 体积是否在可查看范围内；size 未知（0/null）时按可查看处理，等读到内容再判 */
export function canView(size?: number | null): boolean {
  const n = Number(size || 0);
  return !(n > MAX_VIEW_BYTES);
}


/** 常见二进制格式的魔数（只看文件头，与后缀无关） */
const BINARY_MAGIC: { offset?: number; bytes: number[] }[] = [
  { bytes: [0x89, 0x50, 0x4e, 0x47] },           // PNG
  { bytes: [0xff, 0xd8, 0xff] },                 // JPEG
  { bytes: [0x47, 0x49, 0x46, 0x38] },           // GIF8
  { bytes: [0x42, 0x4d] },                       // BMP
  { bytes: [0x25, 0x50, 0x44, 0x46] },           // %PDF
  { bytes: [0x50, 0x4b, 0x03, 0x04] },           // ZIP（含 docx / xlsx / apk）
  { bytes: [0x50, 0x4b, 0x05, 0x06] },           // 空 ZIP
  { bytes: [0x1f, 0x8b] },                       // gzip
  { bytes: [0x42, 0x5a, 0x68] },                 // bzip2
  { bytes: [0xfd, 0x37, 0x7a, 0x58] },           // xz
  { bytes: [0x37, 0x7a, 0xbc, 0xaf] },           // 7z
  { bytes: [0x52, 0x61, 0x72, 0x21] },           // RAR!
  { bytes: [0x7f, 0x45, 0x4c, 0x46] },           // ELF
  { bytes: [0x4d, 0x5a] },                       // PE / EXE、DLL
  { bytes: [0xca, 0xfe, 0xba, 0xbe] },           // Java class / Mach-O fat
  { bytes: [0x00, 0x61, 0x73, 0x6d] },           // WebAssembly
  { bytes: [0x53, 0x51, 0x4c, 0x69] },           // SQLite
  { bytes: [0x4f, 0x67, 0x67, 0x53] },           // OggS
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // MP4（ftyp）
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }  // RIFF（wav / webp / avi）
];

function magicHit(head: Uint8Array, m: { offset?: number; bytes: number[] }): boolean {
  const at = m.offset || 0;
  if (head.length < at + m.bytes.length) return false;
  for (let i = 0; i < m.bytes.length; i++) if (head[at + i] !== m.bytes[i]) return false;
  return true;
}

/** 带 BOM 的 UTF-16 / UTF-8：明确是文本（UTF-16 里有大量 NUL，不能按二进制判） */
export function bomOf(head: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' | null {
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8';
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  return null;
}

export function sniffKind(head: Uint8Array): 'text' | 'binary' {
  if (!head.length) return 'text';
  if (bomOf(head)) return 'text';
  for (const m of BINARY_MAGIC) if (magicHit(head, m)) return 'binary';
  let suspicious = 0;
  for (let i = 0; i < head.length; i++) {
    const b = head[i];
    if (b === 0) return 'binary'; // NUL：文本里不该出现
    if (b === 9 || b === 10 || b === 13 || b === 12 || b === 8 || b === 27) continue;
    if (b < 32) suspicious++; 
  }
  return suspicious / head.length > 0.05 ? 'binary' : 'text';
}

/** 可以直接在浏览器里预览的媒体类型 */
export type MediaKind = 'image' | 'audio' | 'video';

/**
 * 读文件头判断是不是能直接预览/播放的媒体（**同样不看后缀**）。
 * 判断出来就不必把内容读进内存：交给 <img>/<audio>/<video> 自己流式加载，
 * 大视频也能播（服务端对媒体支持 Range）。
 */
export function sniffMedia(head: Uint8Array): MediaKind | null {
  const b = head;
  if (b.length < 12) return null;
  const at = (o: number, ...sig: number[]): boolean => sig.every((v, i) => b[o + i] === v);
  // UTF-16 带 BOM 的文本别被下面的「帧同步」误判成音频
  if (bomOf(b)) return null;

  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image'; // PNG
  if (at(0, 0xff, 0xd8, 0xff)) return 'image';       // JPEG
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image'; // GIF8
  if (at(0, 0x42, 0x4d)) return 'image';             // BMP
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image'; // ICO
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image'; // RIFF/WEBP

  if (at(4, 0x66, 0x74, 0x79, 0x70)) return 'video'; // MP4 / MOV / M4V（ftyp）
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'video'; // Matroska / WebM
  if (at(0, 0x46, 0x4c, 0x56, 0x01)) return 'video'; // FLV
  if (at(0, 0x30, 0x26, 0xb2, 0x75)) return 'video'; // ASF / WMV
  if (at(0, 0x00, 0x00, 0x01, 0xba) || at(0, 0x00, 0x00, 0x01, 0xb3)) return 'video'; // MPEG PS / ES
  if (at(0, 0x52, 0x49, 0x46, 0x46) && (at(8, 0x41, 0x56, 0x49, 0x20) || at(8, 0x41, 0x43, 0x4f, 0x4e))) return 'video'; // AVI / ANI

  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) return 'audio'; // WAV
  if (at(0, 0x49, 0x44, 0x33)) return 'audio';       // MP3（带 ID3 头）
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio'; // MP3 / AAC 帧同步
  if (at(0, 0x66, 0x4c, 0x61, 0x43)) return 'audio'; // FLAC
  if (at(0, 0x4f, 0x67, 0x67, 0x53)) return 'audio'; // OggS
  if (at(0, 0x4d, 0x54, 0x68, 0x64)) return 'audio'; // MIDI（MThd）
  return null;
}

/** 按字节解码为字符串（识别 BOM；非法字节退化为替换字符，不抛错） */
export function decodeBytes(bytes: Uint8Array): string {
  const bom = bomOf(bytes);
  try {
    if (bom === 'utf-16le') return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bom === 'utf-16be') return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (bom === 'utf-8') return new TextDecoder('utf-8').decode(bytes.subarray(3));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (e) {
    // 个别运行环境不支持 utf-16 解码器：退化为按 UTF-8 处理
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

// ---------- 语言推断（只看内容） ----------

const SHEBANG_LANG: Record<string, string> = {
  sh: 'bash', bash: 'bash', dash: 'bash', zsh: 'bash', ksh: 'bash',
  python: 'python', python2: 'python', python3: 'python',
  node: 'javascript', nodejs: 'javascript',
  perl: 'perl', ruby: 'ruby', php: 'php', lua: 'lua', fish: 'bash'
};

/**
 * 从内容推断语言，用于语法高亮。
 * 只认高置信度的特征，认不出来返回 null（按纯文本显示）——猜错的高亮反而更难读。
 */
export function detectLanguage(text: string): string | null {
  const head = text.slice(0, 4096);
  const t = head.replace(/^\uFEFF/, '').trimStart();
  if (!t) return null;

  //    分隔符必须用 [ \t] 而不是 \s——\s 能匹配换行，会把下一行的第一个词
  //    当成解释器参数（`#!/bin/bash\nset -e` 被当成解释器 set，白名单里没有就漏判）
  const sh = /^#!\s*(\S+)(?:[ \t]+(\S+))?/.exec(t);
  if (sh) {
    const cmd = (sh[2] ? sh[2] : (sh[1] || '').split('/').pop()) || '';
    const key = cmd.replace(/[0-9.]+$/, '').toLowerCase();
    if (SHEBANG_LANG[key]) return SHEBANG_LANG[key];
  }

  if (/^<\?php\b/i.test(t)) return 'php';
  if (/^<!DOCTYPE html/i.test(t) || /^<html[\s>]/i.test(t)) return 'xml'; // hljs 用 xml 覆盖 html
  if (/^<\?xml\b/i.test(t) || /^<svg[\s>]/i.test(t)) return 'xml';
  if (/^(?:diff --git |--- a\/|\+\+\+ b\/)/m.test(head)) return 'diff';

  // 3) JSON：能否 parse 是唯一的判据。
  //    不要拿「有没有尖括号」当条件——package.json 里的 ">=16" 就带 >，会被误杀
  const jt = t.trim();
  if (/^[[{]/.test(jt)) {
    try {
      JSON.parse(text.length <= 200000 ? text : text.slice(0, 200000));
      return 'json';
    } catch (e) {
      // 大文件可能因截断而 parse 失败：开头像 JSON 对象/数组就按 json 处理
      if (text.length > 200000 && /^[[{]\s*"/.test(jt)) return 'json';
    }
  }

  // 4) 结构化文本：TOML / INI、YAML
  if (/^\[[A-Za-z0-9_.\- ]+\]\s*$/m.test(head) && /^\s*[A-Za-z0-9_.\-]+\s*=/m.test(head)) return 'ini';
  if (/^---\s*$/m.test(head) && /^[A-Za-z0-9_.\-]+\s*:\s*\S/m.test(head)) return 'yaml';

  // 5) 语言关键字（取前若干行，避免大文件全文扫描）
  const body = text.slice(0, 65536);
  if (/^#include\s*[<"]/m.test(body) || /^\s*#(?:define|ifndef|pragma)\s/m.test(body)) return 'c';
  if (/^\s*(?:package\s+main|import\s+\(|func\s+\w+\s*\()/m.test(body)) return 'go';
  // Java 要先判：`public class` 在两边都很常见，放在 C# 后面会被抢走
  if (/^\s*package\s+[\w.]+\s*;/m.test(body) && /^\s*(?:public|private|protected)?\s*class\s+\w+/m.test(body)) return 'java';
  if (/(?:using\s+System\s*;|namespace\s+[\w.]+|public\s+static\s+(?:void|int)\s+Main\b)/m.test(body)) return 'csharp';
  if (/^\s*(?:def|class)\s+\w+.*:\s*$/m.test(body) && /^\s*(?:import|from)\s+\w/m.test(body)) return 'python';
  if (/^\s*(?:from\s+[\w{},\s*]+\s+from\s+['"]|import\s+\w+\s+from\s+['"]|export\s+(?:default|const|function|class)\b)/m.test(body)) return 'typescript';
  if (/^\s*(?:const|let|var|function)\s+\w+|^\s*module\.exports\b|=>\s*\{/m.test(body)) return 'javascript';
  if (/^\s*(?:SELECT|INSERT\s+INTO|UPDATE|CREATE\s+TABLE|ALTER\s+TABLE)\b/im.test(body)) return 'sql';
  if (/^\s*FROM\s+\S+/m.test(body) && /^\s*(?:RUN|CMD|COPY|ENV|WORKDIR|ENTRYPOINT)\s/m.test(body)) return 'dockerfile';
  // CSS：选择器 + 声明块。放在最后判，免得把 JS/TS 里带花括号的写法抢走
  if (/^[.#*]?[A-Za-z][\w\-.# >,:]*\{[^{}]*:\s*[^{};]+;/m.test(body)) return 'css';
  // Markdown：要么有围栏代码块，要么同时有标题和链接（只靠标题太容易误伤普通笔记）
  if (/^```[\w-]*\s*$/m.test(body)) return 'markdown';
  if (/^#{1,6}\s+\S/m.test(body) && /\[[^\]]+\]\([^)\s]+\)/.test(body)) return 'markdown';

  return null;
}

/**
 * 把整体高亮出来的 HTML 按行切开，供虚拟滚动逐行渲染。
 *
 * 难点在于 hljs 的输出里标签会跨行（块注释、模板字符串等），直接 split('\n')
 * 会把标签劈坏。所以这里按「标签栈」走：切行时先补上当前未闭合标签的 </span>，
 * 新行开头再把它们原样开回来——这样每一行自己都是闭合合法的 HTML。
 */
export function splitHtmlLines(html: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  let cur = '';
  const tagName = (t: string): string => t.slice(1).split(/[\s>/]/, 1)[0];
  const closeOpen = (): string => {
    let s = '';
    for (let i = stack.length - 1; i >= 0; i--) s += '</' + tagName(stack[i]) + '>';
    return s;
  };
  const breakLine = (): void => {
    out.push(cur + closeOpen());
    cur = stack.join('');
  };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    const nl = html.indexOf('\n', i);
    // 先处理更靠前的那个（文本段里可能有换行，标签里一定没有）
    if (nl !== -1 && (lt === -1 || nl < lt)) {
      cur += html.slice(i, nl);
      breakLine();
      i = nl + 1;
      continue;
    }
    if (lt === -1) {
      cur += html.slice(i);
      break;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      cur += html.slice(lt);
      break;
    }
    // 标签前面那段文本也得加上（漏掉就把内容吃掉了）
    const tag = html.slice(lt, gt + 1);
    cur += html.slice(i, lt);
    if (tag.startsWith('</')) stack.pop();
    else if (!tag.endsWith('/>')) stack.push(tag);
    cur += tag;
    i = gt + 1;
  }
  out.push(cur);
  return out;
}

/** 文本按行切好（供虚拟滚动逐行渲染），行内是转义后的纯文本 */
export function plainTextLines(text: string): string[] {
  const out: string[] = [];
  const parts = String(text ?? '').split('\n');
  for (const p of parts) {
    out.push(
      p
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    );
  }
  return out;
}

/** 该不该做高亮：体积、单行长度两道闸（都由经验阈值控制，避免卡界面） */
export function shouldHighlight(text: string, bytesLength: number): boolean {
  if (bytesLength > MAX_HIGHLIGHT_BYTES) return false;
  const lines = text.split('\n');
  for (const l of lines) if (l.length > MAX_HIGHLIGHT_LINE) return false;
  return true;
}


/**
 * 可视行窗口（文本视图与 Hex 视图共用）：2MB 文件有十几万行，全量渲染 DOM 会卡死，
 * 所以只渲染 [first, last) 这几行。抽成纯函数（越界、空内容、滚到底都要对）。
 * 缓冲区上下各多渲染 buffer 行，快速滚动时不至于露白。
 */
export function rowWindow(
  totalRows: number,
  scrollTop: number,
  viewH: number,
  rowH: number,
  buffer = 6
): { first: number; last: number } {
  const rows = Math.max(0, Math.floor(Number(totalRows) || 0));
  if (rows === 0) return { first: 0, last: 0 };
  const h = Math.max(1, Number(rowH) || 22);
  const visible = Math.max(1, Math.ceil((Number(viewH) || 0) / h));
  const top = Math.max(0, Number(scrollTop) || 0);
  // 滚到底（或 scrollTop 超界）时不能越过最后一行，否则会渲染出一段空白
  const maxFirst = Math.max(0, rows - visible);
  const first = Math.max(0, Math.min(Math.floor(top / h) - buffer, maxFirst));
  return { first, last: Math.min(rows, first + visible + buffer * 2) };
}

/** 二进制视图的行数（每行 perLine 字节） */
export function hexRowCount(byteLength: number, perLine = 16): number {
  const n = Math.max(0, Number(byteLength) || 0);
  const per = Math.max(1, Math.floor(perLine) || 16);
  return Math.ceil(n / per);
}

/** 偏移地址：8 位小写十六进制，如 000001a0 */
export function hexOffset(offset: number): string {
  return (Number(offset) || 0).toString(16).padStart(8, '0');
}

export function byteHex(b: number): string {
  return (Number(b) & 0xff).toString(16).padStart(2, '0');
}

/** 单字节是否是可打印 ASCII（ASCII 列用它区分淡显） */
export function isPrintableByte(b: number): boolean {
  return b >= 32 && b < 127;
}

/** 单字节在 ASCII 列显示什么：不可打印一律用中点（与常见 hex 编辑器一致） */
export function byteChar(b: number): string {
  return isPrintableByte(b) ? String.fromCharCode(b) : '\u00b7';
}
