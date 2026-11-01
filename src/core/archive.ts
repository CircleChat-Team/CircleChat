/* ============================================================
 * 压缩包在线浏览（ZIP / TAR / TAR.GZ）
 *
 * 为什么要有硬上限：压缩包动辄几十上百 MB，直接读进内存 / 一次性解压
 * 很容易把浏览器标签页卡死。这里从四个层面封顶：
 *   1. 压缩包本身 ≤ MAX_ARCHIVE_BYTES（20MB），超过就只给下载；
 *   2. 最多列 MAX_ARCHIVE_ENTRIES 项，避免超大目录把 DOM 撑爆；
 *   3. 单个条目解压 ≤ MAX_ENTRY_PREVIEW_BYTES（2MB），且**流式解压**，
 *      超过就立即取消，防压缩炸弹；
 *   4. gzip 解压后 ≤ MAX_ARCHIVE_BYTES，防 gzip 炸弹。
 *
 * 支持范围：
 *   - ZIP：store / deflate（浏览器原生 DecompressionStream('deflate-raw')）
 *   - TAR：ustar，含 GNU 长文件名与 PAX path
 *   - GZIP：若解压后是 TAR 就按 TAR 浏览，否则当成单文件
 *   - RAR / 7Z / XZ / BZIP2：能识别，但不在线解压（提示下载）
 *
 * 这是纯逻辑模块，不碰 DOM；解压失败一律抛 Error，由 UI 转成文案。
 * ============================================================ */

/** 压缩包本身的大小上限：超过就只提供下载，避免卡死 */
export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
/** 最多列出的条目数 */
export const MAX_ARCHIVE_ENTRIES = 1000;
/** 单个条目解压后的上限（也是预览大小上限） */
export const MAX_ENTRY_PREVIEW_BYTES = 2 * 1024 * 1024;

export type ArchiveKind = 'zip' | 'tar' | 'gzip' | 'rar' | '7z' | 'xz' | 'bzip2';

export interface ArchiveEntry {
  index: number;
  name: string;
  /** 解压后大小 */
  size: number;
  /** 压缩后大小（tar 与 size 相同） */
  compressedSize: number;
  dir: boolean;
  /** store / deflate / gzip / method-N */
  method: string;
  /** ZIP：本地文件头偏移（读取时再解析） */
  localOffset?: number;
  /** TAR：数据区偏移 */
  dataOffset?: number;
  /** 不能在线解压的原因：encrypted / method / zip64 */
  unsupported?: string;
}

export interface ArchiveListing {
  kind: ArchiveKind;
  entries: ArchiveEntry[];
  /** 是否因为条目数上限被截断 */
  truncated: boolean;
  /** gzip/tar 解压后的字节（读取条目用）；zip 为 undefined（直接读原文件） */
  payload?: Uint8Array;
  /** 整个格式不支持在线浏览（rar/7z/xz/bzip2） */
  unsupported?: boolean;
}

function u16(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8)) & 0xffff;
}

function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function cstr(b: Uint8Array, off: number, len: number): string {
  let end = off;
  const max = Math.min(off + len, b.length);
  while (end < max && b[end] !== 0) end++;
  return new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(off, end));
}

/** tar 的八进制字段（可能有前导空格 / 结尾 NUL） */
function octal(b: Uint8Array, off: number, len: number): number {
  const s = cstr(b, off, len).trim();
  const v = parseInt(s, 8);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function isTar(b: Uint8Array): boolean {
  return (
    b.length >= 262 &&
    b[257] === 0x75 && b[258] === 0x73 && b[259] === 0x74 && b[260] === 0x61 && b[261] === 0x72
  );
}

/** 从文件头（或文件名兜底）识别压缩格式 */
export function detectArchive(head: Uint8Array, name?: string): ArchiveKind | null {
  const b = head || new Uint8Array(0);
  if (b.length >= 4) {
    if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'zip';
    if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21) return 'rar';
    if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) return '7z';
    if (b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a && b[3] === 0x58) return 'xz';
    if (b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68) return 'bzip2';
  }
  if (isTar(b)) return 'tar';
  const n = String(name || '').toLowerCase();
  if (/\.tar$/.test(n)) return 'tar';
  if (/\.(?:tar\.gz|tgz)$/.test(n)) return 'gzip';
  return null;
}

/** 压缩格式是否支持在线浏览（RAR/7Z/XZ/BZIP2 只提示下载） */
export function archiveSupported(kind: ArchiveKind | null): boolean {
  return kind === 'zip' || kind === 'tar' || kind === 'gzip';
}

/* ---------- 解压（带输出上限） ---------- */

async function readCapped(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('no-decompress');
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const v = step.value;
      if (!v) continue;
      total += v.length;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new Error('too-large');
      }
      chunks.push(v);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('no-decompress');
  const ds = new DecompressionStream('deflate-raw');
  // new Uint8Array(data) 复制到独立 ArrayBuffer，满足 BlobPart 的类型要求
  return readCapped(new Blob([new Uint8Array(data)]).stream().pipeThrough(ds), limit);
}

async function gunzip(data: Uint8Array, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('no-decompress');
  const ds = new DecompressionStream('gzip');
  return readCapped(new Blob([new Uint8Array(data)]).stream().pipeThrough(ds), limit);
}

/* ---------- ZIP ---------- */

function findEocd(b: Uint8Array): number {
  const min = Math.max(0, b.length - 65557);
  for (let i = b.length - 22; i >= min; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return i;
  }
  return -1;
}

function listZip(b: Uint8Array): ArchiveListing {
  const eocd = findEocd(b);
  if (eocd < 0) throw new Error('bad-zip');
  const total = u16(b, eocd + 10);
  const cdSize = u32(b, eocd + 12);
  const cdOff = u32(b, eocd + 16);
  // ZIP64（条目数 / 偏移超出 32 位）：20MB 上限下极少见，明确提示不支持
  if (total === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
    return { kind: 'zip', entries: [], truncated: false, unsupported: true };
  }
  if (cdOff + cdSize > b.length) throw new Error('bad-zip');

  const entries: ArchiveEntry[] = [];
  let p = cdOff;
  for (let i = 0; i < total; i++) {
    if (p + 46 > b.length) break;
    if (u32(b, p) !== 0x02014b50) break;
    const flags = u16(b, p + 8);
    const method = u16(b, p + 10);
    const compSize = u32(b, p + 20);
    const uncompSize = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const localOff = u32(b, p + 42);
    const name = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(p + 46, p + 46 + nameLen));
    const dir = name.endsWith('/');
    let unsupported: string | undefined;
    if (flags & 1) unsupported = 'encrypted';
    else if (uncompSize === 0xffffffff || compSize === 0xffffffff || localOff === 0xffffffff) unsupported = 'zip64';
    else if (method !== 0 && method !== 8) unsupported = 'method';

    if (!dir && name) {
      entries.push({
        index: entries.length,
        name,
        size: uncompSize,
        compressedSize: compSize,
        dir: false,
        method: method === 0 ? 'store' : method === 8 ? 'deflate' : 'method-' + method,
        localOffset: localOff,
        unsupported
      });
      if (entries.length >= MAX_ARCHIVE_ENTRIES) break;
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (p >= b.length) break;
  }
  return { kind: 'zip', entries, truncated: entries.length >= MAX_ARCHIVE_ENTRIES };
}

async function readZip(b: Uint8Array, e: ArchiveEntry): Promise<Uint8Array> {
  if (e.unsupported) throw new Error(e.unsupported);
  if (e.localOffset == null) throw new Error('bad-zip');
  const lh = e.localOffset;
  if (lh + 30 > b.length || u32(b, lh) !== 0x04034b50) throw new Error('bad-zip');
  const nameLen = u16(b, lh + 26);
  const extraLen = u16(b, lh + 28);
  const start = lh + 30 + nameLen + extraLen;
  const end = start + e.compressedSize;
  if (start > b.length || end > b.length) throw new Error('bad-zip');
  if (e.size > MAX_ENTRY_PREVIEW_BYTES) throw new Error('too-large');
  const data = b.subarray(start, end);
  if (e.method === 'store') {
    return data.length > MAX_ENTRY_PREVIEW_BYTES ? data.slice(0, MAX_ENTRY_PREVIEW_BYTES) : data.slice();
  }
  return inflateRaw(data, MAX_ENTRY_PREVIEW_BYTES);
}

/* ---------- TAR ---------- */

function listTar(b: Uint8Array): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  let off = 0;
  let longName = '';

  while (off + 512 <= b.length) {
    const h = b.subarray(off, off + 512);
    // 全 0 块 = 结束（规范要求两个，遇到第一个就停）
    let zero = true;
    for (let i = 0; i < 512; i++) {
      if (h[i] !== 0) {
        zero = false;
        break;
      }
    }
    if (zero) break;

    const name0 = cstr(h, 0, 100);
    const size = octal(h, 124, 12);
    const type = h[156];
    const prefix = cstr(h, 345, 155);
    const dataOff = off + 512;
    const blocks = Math.ceil(size / 512) * 512;
    let name = longName || (prefix ? prefix + '/' + name0 : name0);
    longName = '';

    // GNU 长文件名
    if (type === 0x4c) {
      longName = cstr(b, dataOff, Math.min(size, Math.max(0, b.length - dataOff)));
      off = dataOff + blocks;
      continue;
    }
    // PAX 扩展头：从记录里取 path=
    if (type === 0x78) {
      const txt = new TextDecoder('utf-8', { fatal: false }).decode(
        b.subarray(dataOff, Math.min(dataOff + size, b.length))
      );
      const m = /(?:^|\n)\d+ path=(.*)/.exec(txt) || /(?:^|\n)path=(.*)/.exec(txt);
      if (m) longName = m[1];
      off = dataOff + blocks;
      continue;
    }
    if (type === 0x67) {
      // 全局 PAX：跳过
      off = dataOff + blocks;
      continue;
    }

    const dir = type === 0x35 || name.endsWith('/');
    if (!dir && name) {
      out.push({
        index: out.length,
        name,
        size,
        compressedSize: size,
        dir: false,
        method: 'store',
        dataOffset: dataOff
      });
      if (out.length >= MAX_ARCHIVE_ENTRIES) break;
    }
    off = dataOff + blocks;
  }
  return out;
}

function readTar(b: Uint8Array, e: ArchiveEntry): Uint8Array {
  if (e.dataOffset == null) throw new Error('bad-tar');
  if (e.size > MAX_ENTRY_PREVIEW_BYTES) throw new Error('too-large');
  const end = Math.min(e.dataOffset + e.size, e.dataOffset + MAX_ENTRY_PREVIEW_BYTES, b.length);
  return b.slice(e.dataOffset, end);
}

/* ---------- GZIP ---------- */

async function listGzip(b: Uint8Array, name?: string): Promise<ArchiveListing> {
  const payload = await gunzip(b, MAX_ARCHIVE_BYTES);
  if (isTar(payload)) {
    const entries = listTar(payload);
    return { kind: 'gzip', entries, truncated: entries.length >= MAX_ARCHIVE_ENTRIES, payload };
  }
  const base = String(name || 'file').replace(/\.(?:tar\.gz|tgz|gz)$/i, '') || 'file';
  return {
    kind: 'gzip',
    entries: [
      { index: 0, name: base, size: payload.length, compressedSize: b.length, dir: false, method: 'gzip' }
    ],
    truncated: false,
    payload
  };
}

/* ---------- 对外入口 ---------- */

export async function listArchive(bytes: Uint8Array, kind: ArchiveKind, name?: string): Promise<ArchiveListing> {
  switch (kind) {
    case 'zip':
      return listZip(bytes);
    case 'tar': {
      const entries = listTar(bytes);
      return { kind: 'tar', entries, truncated: entries.length >= MAX_ARCHIVE_ENTRIES };
    }
    case 'gzip':
      return listGzip(bytes, name);
    default:
      return { kind, entries: [], truncated: false, unsupported: true };
  }
}

/**
 * 读取一个条目；source 对 zip/tar 是原始压缩包字节，对 gzip 是解压后的 payload。
 * 超过 MAX_ENTRY_PREVIEW_BYTES 抛 'too-large'。
 */
export async function readArchiveEntry(
  source: Uint8Array,
  kind: ArchiveKind,
  entry: ArchiveEntry
): Promise<Uint8Array> {
  if (kind === 'zip') return readZip(source, entry);
  if (kind === 'tar') return readTar(source, entry);
  if (kind === 'gzip') {
    if (entry.dataOffset != null) return readTar(source, entry);
    return source.slice(0, Math.min(source.length, MAX_ENTRY_PREVIEW_BYTES));
  }
  throw new Error('unsupported');
}
