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

/** 超过这个体积不做语法高亮（hljs 在大文件上会阻塞界面好几秒） */
export const MAX_HIGHLIGHT_BYTES = 512 * 1024;

/** 单行超过这么多字符不做高亮（长行会让高亮器退化，且高亮结果也没意义） */
export const MAX_HIGHLIGHT_LINE = 5000;

/** 体积是否在可查看范围内；size 未知（0/null）时按可查看处理，等读到内容再判 */
export function canView(size?: number | null): boolean {
  const n = Number(size || 0);
  return !(n > MAX_VIEW_BYTES);
}

// ---------- 文本 / 二进制判定 ----------

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

/** 读文件头判断是文本还是二进制 */
export function sniffKind(head: Uint8Array): 'text' | 'binary' {
  if (!head.length) return 'text';
  if (bomOf(head)) return 'text';
  for (const m of BINARY_MAGIC) if (magicHit(head, m)) return 'binary';
  let suspicious = 0;
  for (let i = 0; i < head.length; i++) {
    const b = head[i];
    if (b === 0) return 'binary'; // NUL：文本里不该出现
    if (b === 9 || b === 10 || b === 13 || b === 12 || b === 8 || b === 27) continue;
    if (b < 32) suspicious++; // 其它控制字符
  }
  return suspicious / head.length > 0.05 ? 'binary' : 'text';
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

  // 1) shebang：最可靠。
  //    分隔符必须用 [ \t] 而不是 \s——\s 能匹配换行，会把下一行的第一个词
  //    当成解释器参数（`#!/bin/bash\nset -e` 被当成解释器 set，白名单里没有就漏判）
  const sh = /^#!\s*(\S+)(?:[ \t]+(\S+))?/.exec(t);
  if (sh) {
    const cmd = (sh[2] ? sh[2] : (sh[1] || '').split('/').pop()) || '';
    const key = cmd.replace(/[0-9.]+$/, '').toLowerCase();
    if (SHEBANG_LANG[key]) return SHEBANG_LANG[key];
  }

  // 2) 一看开头就知道的
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

/** 该不该做高亮：体积、单行长度两道闸（都由经验阈值控制，避免卡界面） */
export function shouldHighlight(text: string, bytesLength: number): boolean {
  if (bytesLength > MAX_HIGHLIGHT_BYTES) return false;
  const lines = text.split('\n');
  for (const l of lines) if (l.length > MAX_HIGHLIGHT_LINE) return false;
  return true;
}

// ---------- Hex 视图 ----------

/**
 * 生成经典 hex dump 文本：每行「偏移地址 + 16 字节十六进制 + ASCII」。
 * 返回单个字符串（整体塞进一个 <pre>），比生成十几万个 DOM 节点快得多。
 */
export function hexDump(bytes: Uint8Array, perLine = 16): string {
  const out: string[] = [];
  const half = perLine / 2;
  for (let off = 0; off < bytes.length; off += perLine) {
    const end = Math.min(off + perLine, bytes.length);
    let hex = '';
    let ascii = '';
    for (let i = 0; i < perLine; i++) {
      const p = off + i;
      if (p < end) {
        const b = bytes[p];
        hex += (b < 16 ? '0' : '') + b.toString(16) + ' ';
        ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
      } else {
        hex += '   ';
        ascii += ' ';
      }
      if (i === half - 1) hex += ' ';
    }
    out.push(off.toString(16).padStart(8, '0') + '  ' + hex + '|' + ascii + '|');
  }
  return out.join('\n');
}
