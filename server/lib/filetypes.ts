/* ============================================================
 * 文件类型归类（管理面板的文件列表 / 文件卡片展示用）
 *
 * 按扩展名把上传文件归到更细的类别：图片 / 设计 / 代码 / 音频 / 视频 / 字体 /
 * 文档 / 电子书 / 压缩包 / 磁盘镜像 / 可执行文件。
 *
 * 除了常规扩展名，还处理两类「没有正常扩展名」的文件：
 *   - 点文件：.gitignore / .gitattributes / .env.local / .editorconfig …
 *   - 无扩展名：Dockerfile / Makefile / README / LICENSE …
 * 这些以前一律落进「其他」，在文件管理里很难一眼认出。
 *
 * 注意：这里**只负责展示分类**，与安全策略无关。上传类型判定与静态资源能否
 * 内联（IMAGE_EXTS / VIDEO_EXTS / AUDIO_EXTS、inline 判定）仍在 runtime.ts。
 * ============================================================ */

export type FileKind =
  | 'image'
  | 'design'
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
 *   .psd/.ai → 设计（而不是普通图片：浏览器没法直接渲染，不该按缩略图处理）
 */
const TABLE: { kind: FileKind; exts: string[] }[] = [
  {
    kind: 'image',
    exts: [
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif',
      '.raw', '.cr2', '.nef', '.heic', '.avif',
      '.exr', '.hdr', '.pic', '.pcx', '.tga', '.dds', '.dng', '.orf', '.sr2',
      '.arw', '.rw2', '.raf', '.pef', '.x3f', '.3fr', '.iiq', '.mrw', '.kdc',
      '.cur', '.icns', '.jxl', '.emf', '.wmf', '.ppm', '.pgm', '.pbm', '.pnm'
    ]
  },
  {
    // 设计 / 3D 源文件：浏览器无法直接预览，单独成类，避免被当成可渲染图片
    kind: 'design',
    exts: [
      '.psd', '.psb', '.ai', '.eps', '.indd', '.indt', '.idml',
      '.sketch', '.fig', '.xd', '.xcf', '.kra', '.krz',
      '.afdesign', '.afphoto', '.afpub', '.cdr', '.cdrx', '.clip', '.sai', '.sai2',
      '.procreate', '.ase', '.aseprite',
      '.blend', '.blend1', '.c4d', '.max', '.3ds', '.fbx', '.obj', '.stl',
      '.gltf', '.glb', '.dae', '.ma', '.mb'
    ]
  },
  {
    kind: 'code',
    exts: [
      '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
      '.py', '.pyi', '.pyw', '.pyx', '.pxd',
      '.java', '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx', '.h++',
      '.inl', '.ipp', '.tpp', '.ixx', '.cp',
      '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.kts',
      '.scala', '.sc', '.clj', '.cljs', '.cljc', '.edn', '.hs', '.lua', '.pl', '.pm',
      '.sh', '.bash', '.zsh', '.fish', '.nu',
      '.bat', '.cmd', '.ps1', '.psm1', '.psd1', '.bats',
      '.html', '.htm', '.css', '.scss', '.sass', '.less',
      '.json', '.jsonc', '.json5', '.jsonl', '.ndjson', '.hjson',
      '.xml', '.xsd', '.dtd', '.xslt', '.xpath',
      '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.properties', '.sql',
      '.r', '.rmd', '.qmd', '.dart', '.vue', '.svelte', '.astro',
      '.gradle', '.make', '.mk', '.mak', '.cmake', '.ninja',
      '.bazel', '.bzl', '.star', '.rego', '.cue', '.dhall',
      '.m', '.mm', '.vb', '.vbs', '.fs', '.fsx',
      '.erl', '.hrl', '.ex', '.exs', '.heex', '.eex', '.leex',
      '.el', '.lisp', '.lsp', '.cl', '.scm', '.rkt', '.ss', '.sls', '.sld',
      '.ml', '.mli', '.nim', '.cr', '.zig', '.odin', '.v', '.gleam',
      '.jl', '.mat', '.d', '.di', '.vala', '.vapi',
      '.proto', '.thrift', '.graphql', '.gql', '.sol', '.vy', '.move',
      '.tf', '.hcl', '.dockerfile', '.containerfile',
      '.nix', '.elm', '.purs', '.agda', '.idr', '.lean', '.thy', '.pony',
      '.raku', '.p6', '.pm6', '.awk', '.sed',
      '.asm', '.s', '.nasm', '.cu', '.cuh',
      '.wasm', '.wat',
      '.tex', '.latex', '.bib', '.sty', '.cls', '.dtx',
      '.vim', '.vimrc', '.emacs',
      '.ahk', '.au3',
      '.tcl', '.tk', '.expect',
      '.abap', '.cob', '.cbl', '.cobol',
      '.f', '.f90', '.f95', '.f03', '.f08',
      '.ada', '.adb', '.ads',
      '.sas', '.do', '.ado',
      '.sparql', '.rq', '.ttl', '.n3', '.nt', '.owl',
      '.ipynb', '.diff', '.patch',
      '.csproj', '.vbproj', '.fsproj', '.sln', '.vcxproj', '.xcodeproj', '.plist',
      '.gd', '.gdshader', '.godot', '.tscn', '.tres',
      '.hlsl', '.glsl', '.vert', '.frag', '.geom', '.comp', '.wgsl', '.metal', '.shader',
      '.fnl', '.janet', '.wren', '.re', '.resi',
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

/** 无扩展名 / 特殊文件名（小写）→ 类别 */
const NAME_MAP: Record<string, FileKind> = {
  dockerfile: 'code', containerfile: 'code',
  makefile: 'code', gnumakefile: 'code', 'makefile.am': 'code', 'makefile.in': 'code',
  'cmakelists.txt': 'code', 'meson.build': 'code', 'meson_options.txt': 'code',
  jenkinsfile: 'code', vagrantfile: 'code', gemfile: 'code', rakefile: 'code',
  brewfile: 'code', procfile: 'code', justfile: 'code', taskfile: 'code',
  pkgbuild: 'code', apkbuild: 'code', configure: 'code', sconstruct: 'code', sconscript: 'code',
  build: 'code', workspace: 'code', 'build.bazel': 'code', 'workspace.bazel': 'code', 'module.bazel': 'code',
  readme: 'document', license: 'document', licence: 'document', changelog: 'document',
  authors: 'document', contributors: 'document', notice: 'document', copying: 'document',
  '.gitignore': 'code', '.gitattributes': 'code', '.gitmodules': 'code', '.gitkeep': 'code',
  '.gitconfig': 'code', '.mailmap': 'document', '.editorconfig': 'code', '.dockerignore': 'code',
  '.npmrc': 'code', '.nvmrc': 'code', '.yarnrc': 'code', '.prettierrc': 'code', '.prettierignore': 'code',
  '.eslintrc': 'code', '.eslintignore': 'code', '.babelrc': 'code', '.stylelintrc': 'code',
  '.htaccess': 'code', '.htpasswd': 'code', '.env': 'code', '.flaskenv': 'code', '.vimrc': 'code',
  '.bashrc': 'code', '.bash_profile': 'code', '.bash_aliases': 'code',
  '.zshrc': 'code', '.zprofile': 'code', '.profile': 'code',
  '.clang-format': 'code', '.clang-tidy': 'code', '.clangd': 'code'
};

/** 点文件前缀：覆盖 .env.local / .git-blame-ignore-revs 这类多变体 */
const DOT_CODE_PREFIX = [
  '.env', '.git', '.eslintrc', '.prettierrc', '.babelrc', '.stylelintrc',
  '.editorconfig', '.npmrc', '.nvmrc', '.yarnrc', '.dockerignore',
  '.htaccess', '.htpasswd', '.clang-format', '.clang-tidy', '.clangd',
  '.bashrc', '.bash_profile', '.bash_aliases', '.zshrc', '.zprofile',
  '.profile', '.vimrc', '.mailmap'
];

/** 无扩展名但带后缀变体的构建文件：Dockerfile.dev / Makefile.am … */
const NAMED_CODE_PREFIX = ['dockerfile', 'containerfile', 'makefile', 'gnumakefile', 'jenkinsfile', 'vagrantfile'];

/** 按文件名（或原始名）判定归类；认不出时为 'other' */
export function fileKindOf(name: string): FileKind {
  const s = String(name || '').toLowerCase();
  const base = s.split(/[\\/]/).pop() || ''; // 只取文件名，忽略路径
  if (!base) return 'other';

  const named = NAME_MAP[base];
  if (named) return named;
  if (NAMED_CODE_PREFIX.some((p) => base === p || base.startsWith(p + '.'))) return 'code';
  if (DOT_CODE_PREFIX.some((p) => base.startsWith(p))) return 'code';

  const i = base.lastIndexOf('.');
  if (i <= 0) return 'other'; // 无扩展名，或未识别的纯点文件
  return MAP.get(base.slice(i)) || 'other';
}
