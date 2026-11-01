/* ============================================================
 * 音乐 ID3 元数据（标题 / 艺术家 / 专辑 / 年份 / 封面）
 *
 * 只做展示需要的最小实现：
 *   - ID3v2.2 / 2.3 / 2.4（TIT2/TPE1/TALB/TYER/TDRC、APIC/PIC）
 *   - ID3v1（文件末尾 128 字节，仅在没有 v2 时兜底）
 *
 * 体积控制：先只取 10 字节判断有没有 ID3v2、标签多大；标签超过 1MB 就放弃，
 * 不会为了读元数据把整首歌下载下来。所有请求都走 HTTP Range。
 * ============================================================ */

export interface Id3Cover {
  mime: string;
  data: Uint8Array;
}

export interface Id3Meta {
  title: string;
  artist: string;
  album: string;
  year: string;
  cover: Id3Cover | null;
  source: 'v2' | 'v1';
}

/** ID3v2 标签体积上限（含封面）；超过就放弃，避免大封面拖慢消息列表 */
const MAX_ID3_BYTES = 1024 * 1024;

function syncsafe(b: Uint8Array, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function be32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function be24(b: Uint8Array, o: number): number {
  return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
}

function decodeWith(label: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return '';
    }
  }
}

/** 文本帧：首字节是编码，后面才是正文 */
function decodeTextFrame(b: Uint8Array): string {
  if (!b.length) return '';
  const enc = b[0];
  const body = b.subarray(1);
  let s = '';
  if (enc === 1) s = decodeWith('utf-16', body); // 带 BOM
  else if (enc === 2) s = decodeWith('utf-16be', body);
  else if (enc === 3) s = decodeWith('utf-8', body);
  else s = decodeWith('iso-8859-1', body);
  return s.replace(/\0+$/g, '').trim();
}

/** APIC（v2.3/2.4）：编码 + MIME\0 + 图片类型 + 描述\0 + 图片数据 */
function parseApic(d: Uint8Array): Id3Cover | null {
  if (d.length < 4) return null;
  const enc = d[0];
  let p = 1;
  let mimeEnd = p;
  while (mimeEnd < d.length && d[mimeEnd] !== 0) mimeEnd++;
  const mime = decodeWith('iso-8859-1', d.subarray(p, mimeEnd)).trim();
  p = mimeEnd + 1;
  if (p >= d.length) return null;
  p++; // picture type
  if (enc === 1 || enc === 2) {
    while (p + 1 < d.length && !(d[p] === 0 && d[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < d.length && d[p] !== 0) p++;
    p++;
  }
  if (p >= d.length) return null;
  const data = d.slice(p);
  if (!data.length) return null;
  return { mime: mime || 'image/jpeg', data };
}

/** PIC（v2.2）：编码 + 3 字符图片格式 + 图片类型 + 描述\0 + 图片数据 */
function parsePic(d: Uint8Array): Id3Cover | null {
  if (d.length < 5) return null;
  const enc = d[0];
  const fmt = decodeWith('iso-8859-1', d.subarray(1, 4)).toUpperCase();
  let p = 4; // 编码 + 格式
  p++; // picture type
  if (enc === 1 || enc === 2) {
    while (p + 1 < d.length && !(d[p] === 0 && d[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < d.length && d[p] !== 0) p++;
    p++;
  }
  if (p >= d.length) return null;
  const data = d.slice(p);
  if (!data.length) return null;
  return { mime: fmt === 'PNG' ? 'image/png' : 'image/jpeg', data };
}

/** ID3v2 总长度（含 10 字节头）；不是 ID3 或超限返回 null */
export function id3v2TagSize(b: Uint8Array): number | null {
  if (b.length < 10) return null;
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null; // "ID3"
  const major = b[3];
  if (major < 2 || major > 4) return null;
  const size = syncsafe(b, 6);
  if (size <= 0 || size > MAX_ID3_BYTES) return null;
  return size + 10;
}

export function parseId3v2(buf: Uint8Array): Id3Meta | null {
  const total = id3v2TagSize(buf);
  if (!total) return null;
  const major = buf[3];
  const flags = buf[5];
  const end = Math.min(buf.length, total);
  let p = 10;

  // 扩展头
  if (flags & 0x40) {
    if (major === 3) p += 4 + be32(buf, p);
    else if (major === 4) p += syncsafe(buf, p);
    else p += 4;
  }

  const meta: Id3Meta = { title: '', artist: '', album: '', year: '', cover: null, source: 'v2' };
  let frames = 0;

  while (p < end && frames++ < 1000) {
    let id = '';
    let size = 0;
    let compressed = false;
    let encrypted = false;

    if (major === 2) {
      if (p + 6 > end) break;
      id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2]);
      size = be24(buf, p + 3);
      p += 6;
      if (!/^[A-Z0-9]{3}$/.test(id) || size <= 0) break;
    } else {
      if (p + 10 > end) break;
      id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
      size = major === 4 ? syncsafe(buf, p + 4) : be32(buf, p + 4);
      const fflags = (buf[p + 8] << 8) | buf[p + 9];
      compressed = major === 3 ? !!(fflags & 0x0080) : !!(fflags & 0x0002);
      encrypted = major === 3 ? !!(fflags & 0x0040) : !!(fflags & 0x0004);
      p += 10;
      if (!/^[A-Z0-9]{4}$/.test(id) || size <= 0) break;
    }

    const data = buf.subarray(p, Math.min(p + size, end));
    if (!compressed && !encrypted) {
      if (id === 'TIT2' || id === 'TT2') meta.title = meta.title || decodeTextFrame(data);
      else if (id === 'TPE1' || id === 'TP1') meta.artist = meta.artist || decodeTextFrame(data);
      else if (id === 'TALB' || id === 'TAL') meta.album = meta.album || decodeTextFrame(data);
      else if (id === 'TYER' || id === 'TYE' || id === 'TDRC') meta.year = meta.year || decodeTextFrame(data).slice(0, 4);
      else if ((id === 'APIC' || id === 'PIC') && !meta.cover) {
        meta.cover = id === 'APIC' ? parseApic(data) : parsePic(data);
      }
    }
    p += size;
  }

  if (!meta.title && !meta.artist && !meta.album && !meta.cover) return null;
  return meta;
}

/** ID3v1：文件末尾 128 字节，字段是 latin1 定长字符串 */
export function parseId3v1(b: Uint8Array): Id3Meta | null {
  if (b.length < 128) return null;
  const t = b.subarray(b.length - 128);
  if (t[0] !== 0x54 || t[1] !== 0x41 || t[2] !== 0x47) return null; // "TAG"
  const str = (o: number, n: number): string =>
    decodeWith('iso-8859-1', t.subarray(o, o + n)).replace(/\0+$/g, '').trim();
  const meta: Id3Meta = {
    title: str(3, 30),
    artist: str(33, 30),
    album: str(63, 30),
    year: str(93, 4),
    cover: null,
    source: 'v1'
  };
  if (!meta.title && !meta.artist && !meta.album) return null;
  return meta;
}

/** 只取指定区间；服务端必须支持 Range（音频走的正是流式 + Range 分支） */
async function fetchRange(src: string, start: number, end: number): Promise<Uint8Array | null> {
  try {
    const res = await fetch(src, {
      credentials: 'same-origin',
      headers: { Range: 'bytes=' + start + '-' + end }
    });
    if (res.status !== 206) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<Id3Meta | null>>();

/**
 * 读取音频的 ID3 元数据（带缓存，避免同一首歌在列表里重复请求）。
 * 先取 10 字节判断 ID3v2 是否存在及标签大小，再按需取标签；没有 v2 才试 v1。
 */
export function loadId3Meta(src: string, size?: number | null): Promise<Id3Meta | null> {
  const key = String(src || '');
  const hit = cache.get(key);
  if (hit) return hit;

  const p = (async (): Promise<Id3Meta | null> => {
    const head = await fetchRange(key, 0, 9);
    if (head && head.length >= 10) {
      const total = id3v2TagSize(head);
      if (total) {
        const buf = await fetchRange(key, 0, total - 1);
        if (buf) {
          const meta = parseId3v2(buf);
          if (meta) return meta;
        }
      }
    }
    // v1：需要知道文件大小，取最后 128 字节
    if (size && size > 128) {
      const tail = await fetchRange(key, size - 128, size - 1);
      if (tail) return parseId3v1(tail);
    }
    return null;
  })();

  cache.set(key, p);
  return p;
}
