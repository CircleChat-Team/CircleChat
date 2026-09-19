/* ============================================================
 * 媒体消息（音频 / 视频）展示用的小工具
 * ============================================================ */

// 与服务端 VIDEO_EXTS / AUDIO_EXTS 对齐。历史上上传的视频/音频可能被存成
// type='file'（例如白名单外的 .mkv），这里按扩展名兜底识别，让旧消息也能预览。
const VIDEO_EXTS = new Set([
  '.mp4', '.webm', '.ogv', '.mov', '.m4v',
  '.mkv', '.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.3gp', '.ts', '.m2ts', '.mts'
]);
const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac',
  '.opus', '.wma', '.amr', '.aiff', '.aif', '.m4b'
]);

/** 取扩展名（大写，不含点）；取不到返回 '' */
export function extOf(name?: string | null): string {
  const s = String(name || '');
  const i = s.lastIndexOf('.');
  const e = i >= 0 ? s.slice(i + 1) : '';
  return e.toUpperCase();
}

/** 判断消息该按哪种媒体渲染：优先用消息类型，type='file' 时按扩展名兜底 */
export function mediaKind(type: string, name?: string | null): 'video' | 'audio' | 'other' {
  if (type === 'video' || type === 'audio') return type;
  if (type !== 'file') return 'other';
  const ext = '.' + extOf(name).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return 'other';
}

/** 时长：秒 → m:ss / h:mm:ss；无效值返回 '' */
export function fmtDur(sec?: number | null): string {
  const total = Math.floor(Number(sec) || 0);
  if (!total || total < 0) return '';
  const p = (n: number): string => (n < 10 ? '0' + n : String(n));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
}
