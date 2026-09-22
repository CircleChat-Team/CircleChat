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
    exts: [
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif',
      '.psd', '.ai', '.eps', '.raw', '.cr2', '.nef', '.heic', '.avif',
      '.exr', '.hdr', '.pic', '.pcx', '.tga', '.dds', '.dng', '.orf', '.sr2',
      '.arw', '.rw2', '.raf', '.pef', '.x3f', '.3fr', '.iiq', '.mrw', '.kdc',
      '.cur', '.icns', '.jxl', '.emf', '.wmf', '.ppm', '.pgm', '.pbm', '.pnm'
    ]
  },
  {
    kind: 'code',
    exts: [
      '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cc', '.cxx',
      '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.kts',
      '.scala', '.clj', '.hs', '.lua', '.pl', '.sh', '.bash', '.zsh', '.fish',
      '.bat', '.cmd', '.ps1', '.html', '.htm', '.css', '.scss', '.sass', '.less',
      '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sql',
      '.r', '.dart', '.vue', '.svelte', '.gradle', '.make', '.cmake',
      '.m', '.mm', '.vb', '.vbs', '.fs', '.fsx',
      '.erl', '.hrl', '.el', '.scm', '.rkt', '.lisp', '.lsp',
      '.ml', '.mli', '.nim', '.cr', '.zig', '.odin', '.v', '.gleam',
      '.jl', '.mat', '.d', '.di', '.vala', '.vapi',
      '.proto', '.thrift', '.graphql', '.gql', '.sol',
      '.tf', '.hcl', '.dockerfile', '.containerfile',
      '.nix', '.elm', '.purs',
      '.asm', '.s', '.nasm', '.cu', '.cuh',
      '.wasm', '.wat',
      '.tex', '.latex', '.bib', '.sty', '.cls', '.dtx',
      '.vim', '.vimrc',
      '.ahk', '.au3',
      '.tcl', '.tk', '.expect',
      '.abap', '.cob', '.cbl', '.cobol',
      '.f', '.f90', '.f95', '.f03', '.f08',
      '.ada', '.adb', '.ads',
      '.flutter'
    ]
  },
  {
    kind: 'audio',
    exts: [
      '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.aiff', '.aif',
      '.ape', '.opus', '.mid', '.midi', '.amr', '.caf',
      '.cda', '.mka', '.tak', '.tta', '.voc', '.spx', '.ac3', '.dts', '.eac3',
      '.dsf', '.dff'
    ]
  },
  {
    kind: 'video',
    exts: [
      '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg',
      '.mpeg', '.3gp', '.3g2', '.ogv', '.mts', '.m2ts', '.vob', '.rm', '.rmvb', '.asf',
      '.mxf', '.m2v', '.m4s', '.ts', '.divx', '.nsv', '.f4v',
      '.h264', '.h265', '.hevc', '.vp8', '.vp9', '.av1'
    ]
  },
  {
    kind: 'font',
    exts: [
      '.ttf', '.otf', '.woff', '.woff2', '.eot', '.pfb', '.pfm', '.fon',
      '.dfont', '.suit', '.pcf', '.snf', '.bdf', '.pfa'
    ]
  },
  {
    kind: 'document',
    exts: [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md',
      '.rtf', '.odt', '.ods', '.odp', '.pages', '.numbers', '.key', '.wps', '.csv',
      '.xps', '.oxps', '.abw', '.zabw',
      '.docm', '.dot', '.dotx', '.dotm', '.xlsm', '.xlt', '.xltx', '.xltm',
      '.pptm', '.pot', '.potx', '.potm', '.pps', '.ppsx', '.ppsm',
      '.odg', '.odb', '.odf',
      '.hwp', '.hwpx',
      '.fd', '.wpd', '.wp', '.wp5',
      '.man', '.info', '.rst', '.adoc', '.asciidoc', '.wiki', '.mediawiki'
    ]
  },
  {
    kind: 'ebook',
    exts: [
      '.epub', '.mobi', '.azw', '.azw3', '.djvu', '.chm', '.lit', '.pdb',
      '.fb2', '.ibooks', '.kfx', '.prc', '.cbr', '.cbz', '.cbt', '.cb7'
    ]
  },
  {
    kind: 'archive',
    exts: [
      '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.cab', '.arj',
      '.lzh', '.z', '.tgz', '.tbz2', '.lz', '.lzma', '.apk', '.jar',
      '.zst', '.zstd', '.lz4', '.lzip', '.lzo', '.txz',
      '.xar', '.cpgz', '.alz', '.ace', '.arc', '.paq', '.pea'
    ]
  },
  {
    kind: 'disk',
    exts: [
      '.iso', '.img', '.vhd', '.vhdx', '.vmdk', '.vdi', '.qcow2', '.dmg',
      '.toast', '.uif', '.isz', '.daa', '.b5i', '.b6i', '.cdi', '.cif', '.nrg',
      '.mdf', '.mds', '.ccd', '.ima', '.vfd', '.flp'
    ]
  },
  {
    kind: 'executable',
    exts: [
      '.exe', '.msi', '.app', '.deb', '.rpm', '.pkg', '.run', '.bin',
      '.com', '.pif', '.gadget', '.xbe', '.xex', '.elf', '.so', '.dll', '.dynlib',
      '.bundle', '.dylib', '.ko', '.sys', '.drv', '.ocx', '.scr'
    ]
  }
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
