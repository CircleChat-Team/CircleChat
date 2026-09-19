/* ============================================================
 * 文件类型归类（管理面板的文件列表 / 文件卡片展示用）
 *
 * 按扩展名把上传文件归到更细的类别：图片 / 代码 / 音频 / 视频 / 字体 /
 * 文档 / 电子书 / 压缩包 / 磁盘镜像 / 可执行文件。
 *
 * 注意：这里**只负责展示分类**，与安全策略无关。上传类型判定与静态资源能否
 * 内联（IMAGE_EXTS / VIDEO_EXTS / AUDIO_EXTS、inline 判定）仍在 runtime.ts。
 * ============================================================ */

export type FileKind =
  | 'image'
  | 'code'
  | 'audio'
  | 'video'
  | 'font'
  | 'document'
  | 'ebook'
  | 'archive'
  | 'disk'
  | 'executable'
  | 'other';

/**
 * 按优先级从高到低排列，越靠前越先命中。
 * 少数扩展名会同时出现在多类里，这里的取舍是：
 *   .ts    → 代码（而不是 MPEG-TS 视频）
 *   .pdf   → 文档（而不是电子书）
 *   .iso/.dmg → 磁盘镜像（而不是压缩包 / 可执行文件）
 *   .jar/.apk → 压缩包
 */
const TABLE: { kind: FileKind; exts: string[] }[] = [
  {
    kind: 'image',
    exts: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif',
      '.psd', '.ai', '.eps', '.raw', '.cr2', '.nef', '.heic', '.avif']
  },
  {
    kind: 'code',
    exts: ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cc', '.cxx',
      '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.kts',
      '.scala', '.clj', '.hs', '.lua', '.pl', '.sh', '.bash', '.zsh', '.fish',
      '.bat', '.cmd', '.ps1', '.html', '.htm', '.css', '.scss', '.sass', '.less',
      '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sql',
      '.r', '.dart', '.vue', '.svelte', '.gradle', '.make', '.cmake']
  },
  {
    kind: 'audio',
    exts: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.aiff', '.aif',
      '.ape', '.opus', '.mid', '.midi', '.amr', '.caf']
  },
  {
    kind: 'video',
    exts: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg',
      '.mpeg', '.3gp', '.3g2', '.ogv', '.mts', '.m2ts', '.vob', '.rm', '.rmvb', '.asf']
  },
  { kind: 'font', exts: ['.ttf', '.otf', '.woff', '.woff2', '.eot', '.pfb', '.pfm', '.fon'] },
  {
    kind: 'document',
    exts: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md',
      '.rtf', '.odt', '.ods', '.odp', '.pages', '.numbers', '.key', '.wps', '.csv']
  },
  { kind: 'ebook', exts: ['.epub', '.mobi', '.azw', '.azw3', '.djvu', '.chm', '.lit', '.pdb'] },
  {
    kind: 'archive',
    exts: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.cab', '.arj',
      '.lzh', '.z', '.tgz', '.tbz2', '.lz', '.lzma', '.apk', '.jar']
  },
  { kind: 'disk', exts: ['.iso', '.img', '.vhd', '.vhdx', '.vmdk', '.vdi', '.qcow2', '.dmg'] },
  { kind: 'executable', exts: ['.exe', '.msi', '.app', '.deb', '.rpm', '.pkg', '.run', '.bin'] }
];

const MAP = new Map<string, FileKind>();
for (const row of TABLE) {
  for (const ext of row.exts) {
    if (!MAP.has(ext)) MAP.set(ext, row.kind); // 先出现的类别优先
  }
}

/** 按文件名（或原始名）的扩展名判定归类；认不出时为 'other' */
export function fileKindOf(name: string): FileKind {
  const s = String(name || '').toLowerCase();
  const i = s.lastIndexOf('.');
  if (i < 0) return 'other';
  return MAP.get(s.slice(i)) || 'other';
}
