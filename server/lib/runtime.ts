/* ============================================================
 * CircleChat 运行时（Nitro 版，对应 server.js）
 *
 * 本文件是 server.js 的 1:1 搬迁：HTTP 路由 / 静态服务 / WebSocket
 * 连接管理 / 客户端广播 / 文件清理 全部保留，行为与原版一致。
 * 仅将入口从「自建 http 服务器」改为「导出 handler 供 Nitro 挂载」：
 *   - handleHttp 经 server/routes/[...].ts 的 fromNodeHandler 接管全部 HTTP
 *   - handleWsUpgrade 经 server/plugins/ws.ts 的 listen 钩子挂载到 upgrade
 *   - 启动初始化（migrate/auth/store/audit + mkdir + 清理定时器）在 bootstrap 插件
 * 路径解析锚定到运行根目录（process.cwd()，即 package.json 启动目录 = 项目根）；
 * Nitro 打包后 import.meta.url 指向 .output/server/index.mjs，不再可靠。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

import * as auth from './auth';
import * as store from './store';
import * as groups from './groups';
import * as friends from './friends';
import * as audit from './audit';
import * as moderate from './moderate';
import * as mailbox from './mailbox';
import * as appconfig from './appconfig';
import * as github from './github';
import * as captcha from './captcha';
import { fileKindOf } from './filetypes';
import * as wsproto from './ws';
import * as logger from './log';

// 审计详情结构化：以 {k: i18n 键, v: 占位变量} 形式写入 detail 字段，
// 前端按当前语言翻译；旧版直接写死的中文详情作为兜底原样显示
function auditDetail(key: string, vars?: Record<string, unknown>): string {
  return JSON.stringify({ k: key, v: vars || {} });
}

// ---------- 配置 ----------
const ROOT = process.cwd(); // 运行根目录（启动目录 = 项目根），Nitro 打包后改用 process.cwd()
const PUB = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUB, 'uploads');
// 上传临时目录：multipart 边收边写到这里，落盘校验（去重/魔数）通过后再 rename 进 UPLOAD_DIR。
// 独立成子目录是为了让「文件列表 / 静态服务」天然忽略半成品文件。
const TMP_DIR = path.join(UPLOAD_DIR, '.tmp');
// 上传上限（readBody 与消息 size 校验都用它）。改这里时同步更新文案 api.upload.tooLarge。
const MAX_UPLOAD = 100 * 1024 * 1024; // 单文件上限 100MB
// 请求体上限要留足 multipart 头尾开销：否则"文件刚好 99.x MB"会在传完之后才被拒，
// 客户端却已经允许了，表现就是传到末尾失败 / 卡住。
const MAX_UPLOAD_BODY = MAX_UPLOAD + 1024 * 1024;
const MAX_TEXT_LEN = 4096;           // 单条文本长度上限

// ---------- 分片上传 ----------
// 大文件拆成固定大小的分片并行上传：单片失败只需重传该片，且可在断线/刷新后续传。
// CHUNK_SIZE 必须与前端 src/core/chat.ts 的 CHUNK_SIZE 保持一致。
const CHUNK_SIZE = 5 * 1024 * 1024;                                  // 每片 5MB
const MAX_CHUNKS = Math.ceil(MAX_UPLOAD / CHUNK_SIZE) + 1;           // 分片数上限（多留 1 片余量）
const CHUNK_BODY_LIMIT = CHUNK_SIZE + 1024 * 1024;                   // 单片请求体上限（含 multipart 开销）
// 分片会话：每个上传会话一个目录，里面是 meta.json + <index>.part
const SESS_DIR = path.join(TMP_DIR, 'sessions');
const UPLOAD_ID_RE = /^[a-f0-9]{24}$/;
const CHUNK_SHA_RE = /^[a-f0-9]{64}$/;                                  // 客户端上报的分片 sha256
const SESSION_TTL = 24 * 3600 * 1000; // 会话（半成品）保留 24 小时，过期由 purgeUploadTmp 清掉
/** 会话元数据内存缓存（见 readSession） */
const sessionCache = new Map<string, SessionMeta>();
/** 正在合并的会话：同一 uploadId 的 complete 串行化，避免重复读分片 / 重复写目标文件 */
const mergingUploads = new Set<string>();

// 上传文件保留天数：超期后删除硬盘文件，消息记录保留并显示「图片/文件已过期」
// 可用环境变量 FILE_TTL_DAYS 覆盖，默认 15 天
const FILE_TTL_DAYS = Math.max(1, parseInt(process.env.FILE_TTL_DAYS as string, 10) || 15);
const FILE_CLEANUP_INTERVAL = 6 * 3600 * 1000; // 每 6 小时检查一次

// 管理员新建用户时的用户名规则：2-20 位字母/数字/下划线/中文/点/横线
const USERNAME_RE = /^[\w\u4e00-\u9fa5\-.]{2,20}$/;
// 邮箱格式（简单通用校验）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASS_LEN = 8;
const MAX_PASS_LEN = 64;

// 密码强度：长度 ≥8，且必须同时包含数字、小写字母、大写字母、特殊符号
function passwordStrength(p: string): boolean {
  if (typeof p !== 'string' || p.length < MIN_PASS_LEN || p.length > MAX_PASS_LEN) return false;
  return /[0-9]/.test(p) && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[^A-Za-z0-9]/.test(p);
}

// 图片扩展名（仅用于「扩展名伪装成图片但内容不是图片」时降级处理）
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
// 视频/音频扩展名：按扩展名归类为 video/audio（可内联播放；不可脚本执行，安全）
// 能否真正解码取决于浏览器（如 .mkv/.avi 多数浏览器不支持内联播放），
// 前端在播放失败时会降级提示「下载后用本地播放器打开」。
const VIDEO_EXTS = new Set([
  '.mp4', '.webm', '.ogv', '.mov', '.m4v',
  '.mkv', '.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.3gp', '.ts', '.m2ts', '.mts'
]);
const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac',
  '.opus', '.wma', '.amr', '.aiff', '.aif', '.m4b'
]);

// 上传目录内的合法文件名：随机 hex + 扩展名（与上传落盘、消息校验同一套规则）。
// 文件管理的「列出 / 删除」据此严格校验，杜绝 ../ 之类的路径穿越。
const UPLOAD_NAME_RE = /^[a-zA-Z0-9]+\.[a-z0-9]{1,8}$/;

// ---------- 工具函数 ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  // 与上面 VIDEO_EXTS / AUDIO_EXTS 对齐：必须是 video/* 或 audio/* 才会被允许内联
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
  '.amr': 'audio/amr',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.m4b': 'audio/mp4'
};

/** 附加响应头（例如跨域头）；与默认头同名的会覆盖默认头 */
function sendJSON(res: any, status: number, obj: unknown, extraHeaders?: Record<string, string>): void {
  // 连接可能已被客户端断开或请求体超限后销毁，此时写响应会抛错
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(extraHeaders || {})
  });
  res.end(body);
}

function readBody(req: any, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    // 已知 Content-Length 时预分配整块：避免 chunks 数组 + Buffer.concat 造成的
    // 约两倍内存峰值（100MB 上传会瞬间吃掉 200MB+，是大文件"卡住"的主因之一）。
    const declared = parseInt(req.headers['content-length'] as string, 10);
    const buf: Buffer | null =
      Number.isFinite(declared) && declared > 0 && declared <= limit ? Buffer.allocUnsafe(declared) : null;
    let offset = 0;
    const chunks: Buffer[] = [];

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    req.on('data', (c: Buffer) => {
      if (settled) return;
      size += c.length;
      if (size > limit) {
        settle(() => reject(new Error('BODY_TOO_LARGE')));
        try { req.destroy(); } catch (e) { /* 忽略 */ }
        return;
      }
      if (buf) {
        c.copy(buf, offset);
        offset += c.length;
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => settle(() => resolve(buf ? buf.subarray(0, size) : Buffer.concat(chunks))));
    // 客户端中断 / 连接断开时必须结束 Promise：否则这个请求会永远悬挂，
    // 表现为"取消上传或网络抖动后，服务端一直不响应"（大文件上传时会误判成卡死）。
    const onFail = (e?: Error): void => settle(() => reject(e || new Error('REQUEST_ABORTED')));
    req.on('error', onFail);
    req.on('aborted', onFail);
    req.on('close', () => {
      if (!req.complete) onFail();
    });
  });
}

// ---------- 静态资源版本号（?v=<内容哈希>） ----------

/**
 * 构建产物的文件名是固定的（assets/chat.js、assets/tailwind.css，不带 hash），
 * 一旦被浏览器或中间缓存留住，就会出现「代码更新了、页面还是旧的」。
 * 这里在响应 HTML 时，给页面里引用的本地静态资源按**文件内容哈希**补上 `?v=`：
 *   - 内容没变 → 版本不变，缓存照旧命中，不浪费带宽；
 *   - 内容一变 → URL 就变，浏览器/边缘节点必然重新拉取。
 * 用内容哈希而不是时间戳/随机数：后者会让每次请求都是新 URL，等于把缓存彻底废掉。
 * （HTML 本身一直是 no-cache，所以每次都会拿到最新版本号。）
 */
const assetHashCache = new Map<string, string>();
const htmlInjectCache = new Map<string, string>();

/** 静态文件的内容哈希（取前 8 位）；读不到返回 '' */
function assetHash(filePath: string): string {
  const hit = assetHashCache.get(filePath);
  if (hit !== undefined) return hit;
  let h = '';
  try {
    h = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 8);
  } catch (e) {
    /* 文件不存在（页面引用了尚未构建的产物）→ 视为无版本 */
  }
  assetHashCache.set(filePath, h);
  return h;
}

/** 给 HTML 里的本地静态资源引用补 `?v=<内容哈希>`；外链/上传目录/api 一律不动 */
function injectAssetVersions(html: string): string {
  return html.replace(/(\s(?:src|href)=")([^"]*?)"/g, (all: string, pre: string, url: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return all; // 外链 / data: / 锚点
    const bare = url.split('?')[0].split('#')[0];
    if (!bare) return all;
    const abs = path.normalize(path.join(PUB, bare.replace(/^\.?\//, '/')));
    if (!abs.startsWith(PUB + path.sep)) return all;              // 路径越界
    if (abs.startsWith(UPLOAD_DIR + path.sep)) return all;       // 上传文件不做版本号
    const v = assetHash(abs);
    if (!v) return all;                                          // 不是本地真实静态文件
    return pre + bare + '?v=' + v + '"';                          // 原有 ?v= 会被替换成当前哈希
  });
}

// ---------- 静态文件服务（含 gzip、路径穿越防护） ----------

function serveStatic(req: any, res: any, pathname: string): void {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    res.writeHead(400); res.end('Bad Request'); return; // 非法 URL 编码，防止崩溃
  }
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUB, rel));
  if (!filePath.startsWith(PUB + path.sep) && filePath !== path.join(PUB, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (err: any, st: any) => {
    if (err || !st.isFile()) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    let type = MIME[ext] || 'application/octet-stream';
    // 上传目录防存储型 XSS：仅图片(png/jpeg/gif/webp)与视频/音频可内联，其余一律作为附件下载，
    // 避免 .html / .svg / .xml 等被浏览器以本站同源页面身份渲染并执行脚本。
    const inlineOk = /^image\/(png|jpeg|gif|webp)$/.test(type) || /^(video|audio)\//.test(type);
    let attachment = false;
    if (filePath.startsWith(UPLOAD_DIR + path.sep) && !inlineOk) {
      type = 'application/octet-stream';
      attachment = true;
    }
    // JS/CSS/HTML 不缓存，保证更新后立即生效；图片类资源随机文件名，可长期缓存；
    // vendor 是体积较大的第三方静态资源（很少变动），缓存 7 天，升级时改页面上的 ?v= 即可
    const isVendor = filePath.startsWith(path.join(PUB, 'vendor') + path.sep);
    const cache = isVendor
      ? 'public, max-age=604800'
      : (/\.(png|jpg|jpeg|gif|webp|ico|svg)$/.test(ext) ? 'public, max-age=86400' : 'no-cache');
    // 媒体（视频/音频）走流式 + Range 响应：
    // 之前整文件 fs.readFile 读入内存再切片，大文件开播前要等整个文件读完，导致“等待开始慢 / 音频卡顿”。
    // 改成分段 createReadStream，按需只读需要的字节，开始播放与拖动进度都立即响应。
    if (!attachment && /^(video|audio)\//.test(type)) {
      const total = st.size;
      const h: Record<string, string> = {
        'Content-Type': type,
        'Cache-Control': cache,
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'bytes'
      };
      const range = req.headers['range'];
      const rm = range && /^bytes=(\d*)-(\d*)$/.exec(range);
      if (rm) {
        let start = rm[1] ? parseInt(rm[1], 10) : 0;
        let end = rm[2] ? parseInt(rm[2], 10) : total - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= total) end = total - 1;
        if (start > end) { res.writeHead(416, { 'Content-Range': 'bytes */' + total }); res.end(); return; }
        h['Content-Range'] = 'bytes ' + start + '-' + end + '/' + total;
        h['Content-Length'] = String(end - start + 1);
        res.writeHead(206, h);
        const rs = fs.createReadStream(filePath, { start, end });
        rs.on('error', () => { try { res.destroy(); } catch { /* 忽略 */ } });
        rs.pipe(res);
        return;
      }
      h['Content-Length'] = String(total);
      res.writeHead(200, h);
      const rs = fs.createReadStream(filePath);
      rs.on('error', () => { try { res.destroy(); } catch { /* 忽略 */ } });
      rs.pipe(res);
      return;
    }
    fs.readFile(filePath, (e2: any, data: Buffer) => {
      if (e2) { res.writeHead(500); res.end(); return; }
      // HTML：注入静态资源的 ?v=<内容哈希>（必须在 gzip 之前；结果按文件缓存，不每请求重算）
      if (ext === '.html') {
        let out = htmlInjectCache.get(filePath);
        if (out === undefined) {
          out = injectAssetVersions(data.toString('utf8'));
          htmlInjectCache.set(filePath, out);
        }
        data = Buffer.from(out, 'utf8');
      }
      const acceptGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const big = data.length > 512 && /\.(html|css|js|json|svg|txt|md)$/.test(ext);
      const headers: Record<string, string> = {
        'Content-Type': type,
        'Cache-Control': cache,
        'X-Content-Type-Options': 'nosniff'
      };
      if (attachment) headers['Content-Disposition'] = 'attachment';
      // 先压缩再发头，避免 writeHead 后 setHeader 报错
      if (acceptGzip && big) {
        try {
          const gz = zlib.gzipSync(data);
          headers['Content-Encoding'] = 'gzip';
          res.writeHead(200, headers);
          res.end(gz);
          return;
        } catch (e) { /* 压缩失败则回退未压缩 */ }
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

// ---------- multipart 解析（边收边写盘，仅支持文件字段） ----------

interface StreamedFile {
  /** 原始文件名（已做路径/非法字符清理） */
  name: string;
  /** 文件字节数 */
  size: number;
  /** 内容 sha256（十六进制），用于去重 */
  sha: string;
  /** 已落盘的临时文件绝对路径，调用方负责 rename 或删除 */
  tmpPath: string;
  /** 前 16 字节，供图片魔数嗅探 */
  head: Buffer;
}

/** 流式解析的落盘参数：分片上传需要更小的上限与独立的会话目录 */
interface StreamOpts {
  /** 单次请求允许的最大文件字节数，默认 MAX_UPLOAD（单文件上限） */
  maxBytes?: number;
  /** 临时文件落盘目录，默认 TMP_DIR */
  dir?: string;
}

/**
 * 流式解析 multipart，把 name="file" 的字段直接写入 dir 下的临时文件，并增量计算 sha256。
 *
 * 对比「先 readBody 收全量、再 parseMultipart 切片」：
 *   1. 内存占用从「约等于文件大小」降到常数级（只保留一个边界扫描窗口），
 *      大文件上传不再出现内存尖峰，多路并发上传也更安全；
 *   2. 数据边到边写盘，收到即可开始持久化，省掉一次整块 memcpy；
 *   3. 未命中的其他字段 / 前导垃圾内容直接丢弃，不驻留内存。
 *
 * 失败语义：超过 maxBytes → TOO_LARGE；没有 file 字段 → NO_FILE；请求中断 → REQUEST_ABORTED。
 */
function streamUploadToDisk(req: any, boundary: string, opts: StreamOpts = {}): Promise<StreamedFile> {
  const maxBytes = opts.maxBytes || MAX_UPLOAD;
  const dir = opts.dir || TMP_DIR;
  const bodyLimit = maxBytes + 1024 * 1024; // 留出 multipart 头尾开销
  return new Promise((resolve, reject) => {
    const dash = Buffer.from('--' + boundary);
    const crlfDash = Buffer.from('\r\n--' + boundary);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(dir, '.tmp-' + crypto.randomBytes(12).toString('hex'));
    const out = fs.createWriteStream(tmpPath);
    const hash = crypto.createHash('sha256');

    let buf: Buffer = Buffer.alloc(0);
    let head: Buffer = Buffer.alloc(0);
    let size = 0;
    let received = 0;
    let name: string | null = null;
    let state: 'preamble' | 'headers' | 'body' | 'skip' = 'preamble';
    let paused = false;
    let settled = false;

    const removeTmp = (): void => { try { fs.unlinkSync(tmpPath); } catch (e) { /* 文件可能尚未创建 */ } };
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      // 超限 / 中断时立刻掐断请求，避免客户端继续白传数据
      if (err.message === 'TOO_LARGE') { try { req.destroy(); } catch (e) { /* 忽略 */ } }
      try { out.destroy(); } catch (e) { /* 忽略 */ }
      removeTmp();
      reject(err);
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      // 等写入流真正 flush 到磁盘再 resolve，保证调用方 rename 时文件已完整
      out.end(() => resolve({ name: name || 'file', size, sha: hash.digest('hex'), tmpPath, head }));
    };
    out.on('error', (e: Error) => fail(e));

    // 写出文件内容：累计大小 / sha / 魔数头；write 出现背压时暂停请求，drain 后继续
    const writeChunk = (chunk: Buffer): void => {
      if (!chunk.length || settled) return;
      size += chunk.length;
      if (size > maxBytes) { fail(new Error('TOO_LARGE')); return; }
      hash.update(chunk);
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
      if (!out.write(chunk)) {
        paused = true;
        req.pause();
        out.once('drain', () => {
          if (settled) return;
          paused = false;
          req.resume();
          pump();
        });
      }
    };

    // 状态机：按需消费 buf，消费不完就留到下一块数据；跨块的边界用「保留尾部」处理
    const pump = (): void => {
      while (!settled && !paused) {
        if (state === 'preamble') {
          const i = buf.indexOf(dash);
          if (i === -1) {
            if (buf.length > dash.length + 2) buf = buf.slice(buf.length - dash.length - 2);
            return;
          }
          const after = i + dash.length;
          if (buf.length < after + 2) { buf = buf.slice(i); return; } // 边界后还有 1 字节没到
          if (buf[after] === 0x2d && buf[after + 1] === 0x2d) { fail(new Error('NO_FILE')); return; } // --boundary-- 收尾
          if (buf[after] === 0x0d && buf[after + 1] === 0x0a) { buf = buf.slice(after + 2); state = 'headers'; continue; }
          buf = buf.slice(i + 1); // 伪边界，继续向后找
          continue;
        }
        if (state === 'headers') {
          const i = buf.indexOf('\r\n\r\n');
          if (i === -1) {
            if (buf.length > 16 * 1024) fail(new Error('BAD_HEADERS'));
            return;
          }
          const header = buf.slice(0, i).toString('latin1');
          buf = buf.slice(i + 4);
          if (partFieldName(header) === 'file') { name = partFilename(header) || 'file'; state = 'body'; }
          else state = 'skip';
          continue;
        }
        if (state === 'skip') {
          const idx = buf.indexOf(crlfDash);
          if (idx === -1) { if (buf.length > crlfDash.length) buf = buf.slice(buf.length - crlfDash.length); return; }
          buf = buf.slice(idx + 2); // 指向下一个 --boundary
          state = 'preamble';
          continue;
        }
        // body：找「\r\n--boundary」判定文件内容结束
        const idx = buf.indexOf(crlfDash);
        if (idx !== -1) {
          const content = buf.slice(0, idx);
          buf = buf.slice(idx); // 保留边界，drain 后重入时 idx===0 不会重复写出
          writeChunk(content);
          if (settled || paused) return;
          finish();
          return;
        }
        if (buf.length > crlfDash.length) {
          const end = buf.length - crlfDash.length;
          const chunk = buf.slice(0, end);
          buf = buf.slice(end); // 尾部可能跨块，留到下次拼接
          writeChunk(chunk);
          if (settled || paused) return;
        }
        return;
      }
    };

    req.on('data', (c: Buffer) => {
      if (settled) return;
      received += c.length;
      if (received > bodyLimit) { fail(new Error('TOO_LARGE')); return; }
      buf = buf.length ? Buffer.concat([buf, c]) : c;
      pump();
    });
    req.on('end', () => { if (!settled) fail(new Error('INCOMPLETE')); });
    const onFail = (e?: Error): void => fail(e || new Error('REQUEST_ABORTED'));
    req.on('error', onFail);
    req.on('aborted', onFail);
    req.on('close', () => { if (!req.complete) onFail(); });
  });
}

/** 清理上传临时目录里的残留文件与过期分片会话（进程被强杀时会留下 .tmp-*，启动时兜底清一次） */
export function purgeUploadTmp(): void {
  const now = Date.now();
  let names: string[] = [];
  try { names = fs.readdirSync(TMP_DIR); } catch (e) { /* 目录不存在视为无需清理 */ }
  for (const n of names) {
    if (n.indexOf('.tmp-') !== 0) continue;
    const p = path.join(TMP_DIR, n);
    try {
      if (now - fs.statSync(p).mtimeMs > SESSION_TTL) fs.unlinkSync(p);
    } catch (e) { /* 忽略 */ }
  }
  // 分片会话目录：超过 TTL 未完成即整目录删除（半成品没有再保留的价值）
  let ids: string[] = [];
  try { ids = fs.readdirSync(SESS_DIR); } catch (e) { return; }
  for (const id of ids) {
    const dir = sessionDir(id);
    try {
      if (now - fs.statSync(dir).mtimeMs <= SESSION_TTL) continue;
      // 名字不合规的（历史遗留 / 手工产物）也一并清掉，否则它们永远不会被回收
      if (UPLOAD_ID_RE.test(id)) removeSession(id);
      else fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) { /* 忽略 */ }
  }
}

// ---------- 分片上传会话（磁盘持久化，支持断线/刷新后续传） ----------

interface SessionMeta {
  /** 原始文件名（已清理非法字符） */
  name: string;
  /** 文件总字节数（客户端声明，落盘时以实际分片大小复核） */
  size: number;
  /** 分片总数 */
  chunks: number;
  /** 归属账号：只有本人能续传/完成自己的会话 */
  owner: string;
  /** 创建时间（毫秒） */
  ts: number;
}

function sessionDir(id: string): string {
  return path.join(SESS_DIR, id);
}

function partPath(dir: string, index: number): string {
  return path.join(dir, index + '.part');
}

/** 第 index 片应有的字节数：最后一片可能不足 CHUNK_SIZE */
function chunkSizeOf(meta: SessionMeta, index: number): number {
  return index === meta.chunks - 1 ? meta.size - index * CHUNK_SIZE : CHUNK_SIZE;
}

/** 清理文件名中的路径与非法字符（与 multipart 的 filename 处理保持同一套规则） */
function safeFileName(name: unknown): string {
  const s = path.basename(String(name || 'file')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return s.slice(0, 120) || 'file';
}

function readSession(id: string): SessionMeta | null {
  // 分片上传期间每个 chunk 请求都要读一次 meta.json，走内存免掉每片一次的同步磁盘读；
  // 磁盘仍是唯一真相（进程重启后由 readSession 回源），缓存只在写入/删除时同步失效。
  const cached = sessionCache.get(id);
  if (cached) return cached;
  try {
    const o = JSON.parse(fs.readFileSync(path.join(sessionDir(id), 'meta.json'), 'utf8')) as SessionMeta;
    if (!o || typeof o.name !== 'string' || !Number.isInteger(o.size) || !Number.isInteger(o.chunks)) return null;
    // 分片数必须与体积自洽，防止 meta 被篡改后越界读写
    if (o.size <= 0 || o.size > MAX_UPLOAD || o.chunks < 1 || o.chunks > MAX_CHUNKS) return null;
    if (o.chunks !== Math.ceil(o.size / CHUNK_SIZE)) return null;
    sessionCache.set(id, o);
    return o;
  } catch (e) {
    return null; // 目录/文件不存在或 JSON 损坏
  }
}

function writeSession(id: string, meta: SessionMeta): void {
  fs.mkdirSync(sessionDir(id), { recursive: true });
  fs.writeFileSync(path.join(sessionDir(id), 'meta.json'), JSON.stringify(meta));
  sessionCache.set(id, meta);
}

function removeSession(id: string): void {
  sessionCache.delete(id); // 缓存生命周期与目录一致：目录没了就不该再从缓存里"读到"它
  try { fs.rmSync(sessionDir(id), { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}

/** 已完整到达服务端的分片序号（大小不符的视为未完成） */
function receivedChunks(meta: SessionMeta, dir: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < meta.chunks; i++) {
    try {
      const st = fs.statSync(partPath(dir, i));
      if (st.isFile() && st.size === chunkSizeOf(meta, i)) out.push(i);
    } catch (e) { /* 该片还没到 */ }
  }
  return out;
}

/**
 * 按序合并所有分片为最终文件（单片时直接 rename，避免多余拷贝）。
 *
 * 全程流式（createReadStream + pipe）：一次只驻留一个分片的缓冲，不整块读入内存，
 * 也不会阻塞事件循环（只有开头/结尾的 rename、unlink 是同步调用）。
 *
 * 两个必须注意的点：
 *   1. `pipe` **不会**把目标流的 error 转给源流，未监听的 'error' 会升级成未捕获异常
 *      直接把进程干掉（磁盘写满 / 权限不足时就会踩到）→ 这里把写入流错误转成 rejection；
 *   2. 失败时主动 destroy 当前读流，避免留下未关闭的 fd。
 */
async function materialize(meta: SessionMeta, dir: string, destPath: string): Promise<void> {
  if (meta.chunks === 1) {
    fs.renameSync(partPath(dir, 0), destPath);
    return;
  }
  const ws = fs.createWriteStream(destPath);
  const opened: fs.ReadStream[] = [];
  let onWsError: (e: Error) => void = () => { /* 下一行立即被替换 */ };
  const wsFailed = new Promise<never>((_resolve, reject) => { onWsError = reject; });
  ws.on('error', (e: Error) => onWsError(e));

  const copy = (async (): Promise<void> => {
    for (let i = 0; i < meta.chunks; i++) {
      const rs = fs.createReadStream(partPath(dir, i));
      opened.push(rs);
      await new Promise<void>((resolve, reject) => {
        rs.on('error', reject);
        rs.on('end', resolve);
        rs.pipe(ws, { end: false });
      });
    }
    await new Promise<void>((resolve) => ws.end(resolve));
  })();

  try {
    // 谁先失败就以谁为准：拷贝出错 或 目标流出错，都会立刻中断
    await Promise.race([copy, wsFailed]);
  } catch (e) {
    for (const rs of opened) {
      try { rs.destroy(); } catch (e2) { /* 忽略 */ }
    }
    try { ws.destroy(); } catch (e2) { /* 忽略 */ }
    try { fs.unlinkSync(destPath); } catch (e2) { /* 忽略 */ }
    throw e;
  }
}

/** 按序读取分片计算整文件 sha256（内存占用为流式，不整块读入） */
async function shaOfParts(meta: SessionMeta, dir: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for (let i = 0; i < meta.chunks; i++) {
    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(partPath(dir, i));
      rs.on('data', (d: Buffer | string) => { hash.update(d); });
      rs.on('error', reject);
      rs.on('end', resolve);
    });
  }
  return hash.digest('hex');
}

/** 读取第 0 片的前 16 字节，用于图片魔数嗅探 */
function headOfFirstPart(dir: string): Buffer {
  const b = Buffer.alloc(16);
  let fd: number | null = null;
  try {
    fd = fs.openSync(partPath(dir, 0), 'r');
    const n = fs.readSync(fd, b, 0, 16, 0);
    return b.subarray(0, n);
  } catch (e) {
    return Buffer.alloc(0);
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* 忽略 */ } }
  }
}

function partFilename(header: string): string | null {
  const m = /filename="((?:[^"\\]|\\.)*)"/i.exec(header);
  if (!m) return null;
  // 浏览器以 UTF-8 原始字节发送，先 latin1 还原字节再转 UTF-8
  let name = Buffer.from(m[1], 'latin1').toString('utf8');
  name = path.basename(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return name.slice(0, 120) || null;
}

function partFieldName(header: string): string {
  const m = /name="([^"]*)"/i.exec(header);
  return m ? m[1] : '';
}

// 图片魔数校验（防伪装文件）
function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// ---------- WebSocket 客户端管理 ----------

const clients = new Set<any>(); // 所有在线 WS 连接
const typingLast = new Map<string, number>(); // 用户名 -> 上次转发「正在输入」的时间（节流用）

// ---------- 最后在线时间 ----------
// 「是否在线」由 WS 连接决定，这里只记**离线那一刻的最后活动时间**，供离线用户显示。
// 内存这份是实时用的（断开瞬间就要能推给前端），库里那份是重启后仍能显示用的。
let lastSeenMap: Record<string, number> | null = null;
const lastSeenWrote = new Map<string, number>(); // 用户名 -> 上次落库时间（写库节流）

function ensureLastSeen(): Record<string, number> {
  if (lastSeenMap) return lastSeenMap;
  const out: Record<string, number> = {};
  try {
    const raw = auth.loadUsers() || {};
    for (const n of Object.keys(raw)) {
      const ts = Number(raw[n].lastSeen || 0);
      if (ts > 0) out[n] = ts;
    }
  } catch (e) {
    /* 读不到就从空开始，不影响主流程 */
  }
  lastSeenMap = out;
  return out;
}

/** 记录「该用户此刻还在线」。force 用于连接/断开这种关键时刻，其余按 60 秒节流落库 */
function markSeen(name: string, force = false): void {
  if (!name) return;
  const now = Date.now();
  ensureLastSeen()[name] = now;
  if (!force) {
    const prev = lastSeenWrote.get(name) || 0;
    if (now - prev < 60000) return; // 心跳触发很频繁，别每次都写库
  }
  lastSeenWrote.set(name, now);
  auth.touchLastSeen(name, now);
}

function lastSeenSnapshot(): Record<string, number> {
  return Object.assign({}, ensureLastSeen());
}

/** 除当前连接外，该用户是否还有别的在线连接（断开时判断是否真的下线了） */
function hasOtherConn(name: string, except: any): boolean {
  for (const c of clients) if (c !== except && clientId(c) === name) return true;
  return false;
}

/** 给一批带 name 的条目补上 lastSeen（群成员列表等；groups 模块只管成员关系，不碰在线状态） */
function withLastSeen<T extends { name: string }>(list: T[]): (T & { lastSeen: number | null })[] {
  const ls = ensureLastSeen();
  return (list || []).map((m) => Object.assign({}, m, { lastSeen: ls[m.name] || null }));
}

const shakeLast = new Map<string, number>(); // 用户名 -> 上次「窗口抖动」时间（服务端限频）
// 抖动最短间隔。前端自己也限一次（更长），这里更短是为了不误伤正常点击，
// 但必须有——恶意连接可以直接发原始帧刷屏，只靠客户端限不住。
const SHAKE_COOLDOWN_MS = 5 * 1000;
const twofaChallenges = new Map<string, { username: string; expires: number }>(); // token -> { username, expires }（登录第二步 2FA）

function clientId(c: any): string {
  return c.user.username;
}

function broadcast(obj: any): void {
  const data = wsproto.encodeText(JSON.stringify(obj));
  for (const c of clients) {
    try { c.socket.write(data); } catch (e) { /* 忽略 */ }
  }
}

function sendTo(client: any, obj: any): void {
  try { client.sendText(JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
}

// 推送给某群的在线成员
function broadcastGid(gid: string, obj: any): void {
  for (const c of clients) {
    if (groups.isMember(gid, c.user.username)) sendTo(c, obj);
  }
}

// 推送给私聊房间（dm 为规范化 key `小:大`）的在线双方
function broadcastDm(dm: string, obj: any): void {
  const pair = String(dm).split(':');
  for (const c of clients) {
    if (pair.indexOf(c.user.username) !== -1) sendTo(c, obj);
  }
}

// 推送给指定用户的全部连接（多端都在线时每端都发）
function broadcastUser(name: string, obj: any): void {
  if (!name) return;
  for (const c of clients) if (clientId(c) === name) sendTo(c, obj);
}

/**
 * 群成员发生变化（加入 / 主动退出 / 被移出）。
 * 该群在线成员刷新成员列表；当事人**单独再发一次**——被移出时他已不在群里，
 * broadcastGid 的 isMember 过滤会把他漏掉，而这恰恰是他最需要知道的。
 */
function notifyMembersChanged(gid: string, name: string, action: 'join' | 'leave' | 'remove'): void {
  if (!gid) return;
  const evt = { type: 'group.members', data: { gid, name, action } };
  broadcastGid(gid, evt);
  broadcastUser(name, evt);
}

// 按房间推送：dm 非空为私聊（仅双方）；gid=null 为公共聊天（全量）；否则按群推成员
function broadcastRoom(gid: string | null, dm: string | null, obj: any): void {
  if (dm != null) broadcastDm(dm, obj);
  else if (gid == null) broadcast(obj);
  else broadcastGid(gid, obj);
}

function broadcastPresence(): void {
  const present = [...new Set(currentPresent())].sort();
  broadcast({
    type: 'presence',
    users: present,
    away: currentAway(),
    platforms: currentPlatforms(),
    // 随广播带上最后在线快照：某人刚离线时前端能立刻显示「最后在线 刚刚」，
    // 不用等下一次拉 /api/users
    lastSeen: lastSeenSnapshot()
  });
}

// 隐身用户对他人显示为离线：凡用于对外展示「在线」的集合都排除 invisible
function currentPresent(): string[] {
  return [...clients].filter((c) => !c.invisible).map(clientId);
}

/**
 * 各在线用户的连接来源：网页端 / 桌面客户端（同一用户可能两端都在）。
 * 前端据此区分「网页在线 / 客户端在线 / 两端同时在线」。
 */
function currentPlatforms(): Record<string, { web: boolean; client: boolean }> {
  const out: Record<string, { web: boolean; client: boolean }> = {};
  for (const c of clients) {
    if (c.invisible) continue; // 隐身者对外等于离线，不暴露来源
    const n = clientId(c);
    const p = out[n] || (out[n] = { web: false, client: false });
    if (c.platform === 'client') p.client = true;
    else p.web = true;
  }
  return out;
}

/**
 * 离开名单：该用户**所有**可见连接都不在前台才算离开。
 * 原来只要有一条连接 away 就把整人标成离开，多端登录时会出现
 * 「桌面端一直在用、网页端标签页在后台」→ 仍显示离开的误判。
 */
function currentAway(): string[] {
  const all = new Set<string>();
  const active = new Set<string>();
  for (const c of clients) {
    if (c.invisible) continue;
    const n = clientId(c);
    all.add(n);
    if (!c.away) active.add(n);
  }
  return [...all].filter((n) => !active.has(n)).sort();
}

/** 连接来源判定：桌面客户端会在 UA 里带 CircleChatDesktop/x.y.z（见前端 src/utils/client.ts） */
function platformOf(ua: unknown): 'client' | 'web' {
  return /CircleChatDesktop\//i.test(String(ua || '')) ? 'client' : 'web';
}

/**
 * 强制某用户重新登录：先告知其在线客户端（跳过 exceptToken 对应的那条连接），再断开。
 * 用于改密后失效会话——客户端收到 logged.out 会跳回登录页。
 */
function forceLogout(name: string, exceptToken?: string): number {
  let n = 0;
  for (const c of [...clients]) {
    if (c.user.username !== name) continue;
    if (exceptToken && c.user.token === exceptToken) continue;
    try { c.sendText(JSON.stringify({ type: 'logged.out' })); } catch (e) { /* 忽略 */ }
    try { c.close(); } catch (e) { /* 忽略 */ }
    n++;
  }
  return n;
}

// 心跳：每 30s 发 Ping，两次未响应则断开
const HEARTBEAT_MS = 30 * 1000;
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { try { c.socket.destroy(); } catch (e) { /* 忽略 */ } continue; }
    c.alive = false;
    try { c.socket.write(wsproto.encodePing()); } catch (e) { /* 忽略 */ }
  }
}, HEARTBEAT_MS).unref();

/**
 * 让所有在线客户端回登录页（服务器重启 / 会话被清空时调用）。
 *
 * 会话只存在进程内存里（auth 的 sessions Map），重启后必然全部失效，
 * 所以这里只是把「你该重新登录了」提前说出去，省得客户端傻等重连。
 * 万一没机会说（进程被强杀），客户端重连时也会拿到 401 自己回登录页。
 */
export function broadcastLogout(reason: string): void {
  const frame = JSON.stringify({ type: 'logged.out', data: { reason } });
  for (const c of Array.from(clients)) {
    try {
      c.socket.write(wsproto.encodeText(frame));
      c.close(); // 顺带断开：客户端 onclose 里也会再确认一次会话，双保险
    } catch (e) {
      /* 忽略 */
    }
  }
}

export function handleWsUpgrade(req: any, socket: any, head: Buffer): void {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const ip = req.socket.remoteAddress || '-';
  if (pathname !== '/ws') {
    logger.write({ ip, proto: 'ws', method: 'UPGRADE', url: pathname, status: 404 });
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const user = auth.authByCookie(req.headers.cookie);
  if (!user) {
    logger.write({ ip, proto: 'ws', method: 'UPGRADE', url: pathname, status: 401, ua: req.headers['user-agent'] });
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (!wsproto.accept(req, socket)) { socket.destroy(); return; }
  if (head && head.length) socket.unshift(head);

  const client: any = {
    socket,
    user,
    alive: true,
    invisible: false, // 隐身：对他人显示为离线
    away: false,      // 离开：在线但页面不在前台
    platform: platformOf(req.headers['user-agent']), // 连接来源：桌面客户端 / 网页端
    close: () => { /* 见下 */ }
  };

  const decoder = new wsproto.Decoder({
    onText: (text: string) => handleWsText(client, text),
    onPing: () => { client.alive = true; try { client.socket.write(wsproto.encodePing()); } catch (e) { /* 忽略 */ } },
    onClose: () => shutdownClient(client, 'close-frame')
  });

  client.close = () => shutdownClient(client, 'local');
  client.sendText = (s: string) => { try { client.socket.write(wsproto.encodeText(s)); } catch (e) { /* 忽略 */ } };

  socket.on('data', (chunk: Buffer) => { client.alive = true; decoder.push(chunk); });
  // 对端直接断开（关标签页 / 断网）时只会触发 end，必须在这里清理，
  // 否则该用户会一直显示在线，直到下一次心跳超时。
  socket.on('end', () => shutdownClient(client, 'end'));
  socket.on('error', () => shutdownClient(client, 'error'));
  socket.on('close', () => shutdownClient(client, 'closed'));

  clients.add(client);
  markSeen(clientId(client), true); // 连上就算「此刻在线」，立刻落库
  broadcastPresence();
  logger.write({ ip, proto: 'ws', method: 'CONNECT', url: '/ws', status: 101, ua: req.headers['user-agent'] });
}

function shutdownClient(client: any, _reason: string): void {
  if (!clients.has(client)) return;
  clients.delete(client);
  typingLast.delete(client.user.username);
  // 多端登录时，还有别的连接就还不算离线，别把时间写早了
  if (!hasOtherConn(client.user.username, client)) markSeen(client.user.username, true);
  try {
    // 先发送 Close 帧再 FIN，确保对端能收到
    client.socket.write(wsproto.encodeClose(1000));
    client.socket.end();
  } catch (e) { /* 忽略 */ }
  logger.write({ ip: client.user.ip, proto: 'ws', method: 'DISCONNECT', url: '/ws', status: 200 });
  broadcastPresence();
}

function handleWsText(client: any, text: string): void {
  client.alive = true;
  let msg: any;
  try { msg = JSON.parse(text); } catch (e) { return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ping') {
    // 顺带续一下「最后在线」：长时间挂着的会话如果遇到进程被杀，
    // 库里记的时间也不会太旧（内部 60 秒节流，不会真的每次写库）
    markSeen(clientId(client));
    client.sendText(JSON.stringify({ type: 'pong', ts: Date.now() }));
    return;
  }
  if (msg.type === 'typing') {
    // 正在输入：服务端再节流一次（同一用户 2 秒内只转发一次），且不回显给发起者
    const u = client.user.username;
    const now = Date.now();
    if (now - (typingLast.get(u) || 0) > 2000) {
      typingLast.set(u, now);
      const frame = wsproto.encodeText(JSON.stringify({ type: 'typing', from: u }));
      // 私聊：只推给对方；公共 / 群聊：推给其余所有在线
      const pm = msg.data && msg.data.pm != null ? String(msg.data.pm).trim() : null;
      if (pm && !friends.isFriend(u, pm)) return; // 非好友不转发「正在输入」
      for (const c of clients) {
        if (c === client) continue;
        if (pm) { if (c.user.username !== pm) continue; }
        try { c.socket.write(frame); } catch (e) { /* 忽略 */ }
      }
    }
    return;
  }
  if (msg.type === 'status') {
    const ds = msg.data || {};
    client.invisible = !!ds.invisible;
    client.away = !client.invisible && !!ds.away;
    broadcastPresence();
    return;
  }
  if (msg.type === 'msg') {
    const d = msg.data || {};
    const type = d.type === 'image' || d.type === 'file' || d.type === 'video' || d.type === 'audio' || d.type === 'merge' || d.type === 'shake' ? d.type : 'text';
    let content = String(d.content || '').slice(0, type === 'merge' ? 8000 : (type === 'text' ? MAX_TEXT_LEN : 300));
    const from = client.user.username;
    // 处罚拦截：禁言 / 封禁 / IP 封禁的用户不能继续发消息
    const block = moderate.blockFor(from, client.user.ip);
    if (block.muted || block.banned) {
      sendTo(client, {
        type: 'penalty',
        data: { muted: block.muted, banned: block.banned, mutedUntil: block.mutedUntil, bannedUntil: block.bannedUntil }
      });
      return;
    }
    // 目标房间：dm 为私聊（对方用户名），否则 gid 为群 / 公共
    let dm: string | null = null;
    if (d.pm !== undefined && d.pm !== null && String(d.pm).trim() !== '') {
      const peer = String(d.pm).trim().slice(0, 64);
      if (peer === from) return; // 不能给自己发私聊
      const raw = auth.loadUsers() || {};
      if (!Object.prototype.hasOwnProperty.call(raw, peer)) return; // 对方账号不存在
      dm = friends.pairKey(from, peer);
    }
    let gid = d.gid != null ? String(d.gid) : null;
    if (gid !== null) {
      if (gid.length > 64) return;
      if (!groups.isMember(gid, from)) return;
    }
    if (dm !== null) {
      // 好友门禁：非好友之间禁止私聊（必须先加好友）
      const peer = dm.split(':').find((x: string) => x !== from);
      if (!peer || !friends.isFriend(from, peer)) return;
    }
    // 防注入：image/file 的 content 必须是本服务器上传目录的合法文件（防 javascript: 等伪造链接）
    // merge（合并转发）的 content 是结构化 JSON：仅做格式与大小校验
    if (type === 'shake') {
      // 「窗口抖动」：只允许私聊（群里抖一次会惊动所有人），并且服务端限频
      if (dm === null) return;
      content = ''; // 抖动没有正文
      const last = shakeLast.get(from) || 0;
      if (Date.now() - last < SHAKE_COOLDOWN_MS) return;
      shakeLast.set(from, Date.now());
    } else if (type === 'text') {
      if (!content.trim()) return;
    } else if (type === 'merge') {
      let parsed: any = null;
      try { parsed = JSON.parse(content); } catch (e) { return; }
      if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length || parsed.items.length > 100) return;
    } else {
      if (!/^\/uploads\/[a-zA-Z0-9]+\.[a-z0-9]{1,8}$/i.test(content)) return;
      if (d.name !== undefined && typeof d.name !== 'string') return;
      if (d.size !== undefined && (!Number.isInteger(d.size) || d.size < 0 || d.size > MAX_UPLOAD)) return;
    }
    // 引用回复：只接受存在且未被撤回的消息；私聊里仅本房间的消息可被引用
    let replyTo: number | undefined = undefined;
    if (d.replyTo !== undefined && d.replyTo !== null) {
      const rid = Number(d.replyTo);
      if (Number.isInteger(rid) && rid > 0) {
        const t = store.get(rid);
        if (t && !t.recalled) {
          const tRoom = t.dm != null ? 'dm:' + t.dm : (t.gid != null ? 'gid:' + t.gid : 'pub');
          const myRoom = dm != null ? 'dm:' + dm : (gid != null ? 'gid:' + gid : 'pub');
          if (tRoom === myRoom) replyTo = rid;
        }
      }
    }
    const record = store.add({
      from,
      type,
      content,
      name: d.name,
      size: d.size,
      replyTo,
      gid,
      dm,
      md: type === 'text' && d.md ? 1 : 0
    });
    audit.add({
      actor: from,
      action: dm != null ? 'dm.msg' : (gid == null ? 'msg' : 'group.msg'),
      target: dm != null ? record.idx : (gid == null ? record.idx : gid),
      detail: auditDetail(type === 'image' ? 'log.detail.msg.image'
        : (type === 'file' ? 'log.detail.msg.file'
          : (type === 'shake' ? 'log.detail.msg.shake' : 'log.detail.msg.text')),
        type === 'text' ? { text: content.slice(0, 40) } : { name: String(d.name || '未命名') }),
      ip: client.user.ip
    });
    broadcastRoom(gid, dm, { type: 'msg', data: record });
  }
  if (msg.type === 'react') {
    const d = msg.data || {};
    const idx = Number(d.idx);
    if (!Number.isInteger(idx) || idx <= 0) return;
    // 按码点截断，避免把一个 emoji（可能由多个码点组成）截坏
    const emoji = Array.from(String(d.emoji || '')).slice(0, 4).join('').trim();
    if (!emoji) return;
    const target = store.get(idx);
    if (!target || target.recalled) return; // 不存在的或已撤回的消息不能回应
    if (target.dm != null) {
      const pair = String(target.dm).split(':');
      if (pair.indexOf(client.user.username) === -1) return; // 私聊仅双方可回应
    }
    const state = store.toggleReaction(idx, emoji, client.user.username);
    broadcastRoom(target.gid ?? null, target.dm ?? null, {
      type: 'reaction',
      data: { idx, emoji, added: state.added, reactions: state.reactions, by: client.user.username }
    });
  }
  if (msg.type === 'recall') {
    const d = msg.data || {};
    const idx = Number(d.idx);
    if (!Number.isInteger(idx) || idx <= 0) return;
    const target = store.get(idx);
    if (!target || target.recalled) return; // 不存在或已撤回
    if (target.dm != null) {
      const pair = String(target.dm).split(':');
      if (pair.indexOf(client.user.username) === -1) return; // 私聊仅双方可撤回
    }
    const adm = auth.isAdmin(client.user.username);
    // 只能撤回自己的消息；管理员可撤回任意人的消息
    if (target.from !== client.user.username && !adm) return;
    if (!store.recall(idx, client.user.username)) return;
    const room = target.gid != null ? String(target.gid) : null;
    audit.add({
      actor: client.user.username,
      action: target.dm != null ? 'dm.recall' : (room == null ? 'recall' : 'group.recall'),
      target: idx,
      detail: auditDetail(target.from === client.user.username
        ? 'log.detail.recall.self' : 'log.detail.recall.byAdmin',
        target.from === client.user.username ? {} : { user: target.from }),
      ip: client.user.ip
    });
    broadcastRoom(room, target.dm ?? null, {
      type: 'recall',
      data: {
        idx,
        by: client.user.username,
        owner: target.from,
        admin: adm && target.from !== client.user.username
      }
    });
  }
}

// ---------- 落盘收尾（单次上传与分片上传共用同一套归类 / 去重 / 命名规则） ----------

interface FinalizedUpload {
  kind: 'image' | 'video' | 'audio' | 'file';
  url: string;
  name: string;
  size: number;
  deduped: boolean;
}

/** 改名落盘；跨设备或被占用时退回「拷贝 + 删源」 */
function renameOrCopy(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    fs.copyFileSync(src, dest);
    try { fs.unlinkSync(src); } catch (e2) { /* 忽略 */ }
  }
}

/**
 * 上传收尾：按魔数/扩展名归类 → 按内容 sha256 去重 → 把内容落到 UPLOAD_DIR 的随机名。
 * @param place 真正把内容写到 destPath 的动作（单次上传是 rename，分片上传是按序合并）
 */
async function finalizeUpload(
  head: Buffer,
  origName: string,
  size: number,
  sha: string,
  place: (destPath: string) => void | Promise<void>
): Promise<FinalizedUpload> {
  const ext = path.extname(origName).toLowerCase();
  // 不限文件类型，一律接收。
  // 图片按文件内容（魔数）判断；视频/音频按扩展名归类（可内联播放、不可脚本执行，安全）。
  const sniffed = sniffImage(head);
  let kind: FinalizedUpload['kind'];
  let saveExt: string;
  if (sniffed) {
    kind = 'image';
    saveExt = '.' + sniffed; // 用嗅探出的真实格式，保证能被正确内联显示
  } else {
    const safeExt = /^\.[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : '.bin';
    saveExt = IMAGE_EXTS.has(safeExt) ? '.bin' : safeExt; // 扩展名伪装成图片但内容不是 → 降级 .bin
    kind = VIDEO_EXTS.has(saveExt) ? 'video' : (AUDIO_EXTS.has(saveExt) ? 'audio' : 'file');
  }
  // 内容去重：按 sha256 判断这份内容是否已经落过盘，是的话直接复用已有文件，
  // 磁盘上同一份内容只会存一遍（多条消息可以指向同一个 /uploads/xxx）。
  const hit = store.findUploadBySha(sha);
  let saveName: string;
  let deduped = false;
  if (hit && UPLOAD_NAME_RE.test(hit) && fs.existsSync(path.join(UPLOAD_DIR, hit))) {
    saveName = hit; // 命中且文件还在 → 不再写盘
    deduped = true;
  } else {
    saveName = crypto.randomBytes(8).toString('hex') + saveExt;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    await place(path.join(UPLOAD_DIR, saveName));
    store.putUpload(sha, saveName, size);
  }
  // 复用已有文件时类型要按最终落盘名判定：扩展名可能和本次上传的原始扩展名不同
  const finalExt = path.extname(saveName).toLowerCase();
  if (!sniffed) kind = VIDEO_EXTS.has(finalExt) ? 'video' : (AUDIO_EXTS.has(finalExt) ? 'audio' : 'file');
  return { kind, url: '/uploads/' + saveName, name: origName, size, deduped };
}

// ---------- HTTP 路由 ----------

/**
 * 应用标识与版本（供 /api/app-manifest 下发）。
 * 环境变量优先，缺省读 package.json 的 name/version——版本随发布自动更新，
 * 不必在代码里维护一份会过期的常量。
 */
function readAppInfo(): { id: string; version: string } {
  let id = 'circlechat';
  let version = '0.0.0';
  try {
    const o = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { name?: string; version?: string };
    if (o && typeof o.name === 'string' && o.name) id = o.name;
    if (o && typeof o.version === 'string' && o.version) version = o.version;
  } catch (e) {
    // 工作目录里没有 package.json（容器启动时 cwd 未必是项目根）：用兜底值
  }
  return {
    id: process.env.CIRCLECHAT_APP_ID || process.env.APP_ID || id,
    version: process.env.APP_VERSION || version
  };
}
const APP_INFO = readAppInfo();

/**
 * /api/app-manifest 的跨域响应头。
 * 桌面应用（Electron / Tauri / 本地客户端）没有同源概念，来源直接放开。
 * 该接口不下发凭据、也不认 Cookie，放开来源不会扩大本站的攻击面。
 */
const APP_MANIFEST_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

// ---------- 第三方登录：GitHub OAuth ----------

// client_id / client_secret 由管理员在管理面板里填，存在 app_config 表里；
// **不在代码里写死**，secret 也永远不会下发给任何前端。
const GH_CFG_ID = 'oauth.github.clientId';
const GH_CFG_SECRET = 'oauth.github.clientSecret';
// 端点允许用环境变量改指到本地桩服务，便于端到端自测（默认是真实 GitHub）
const GH_BASE = process.env.GITHUB_BASE || 'https://github.com';
const GH_AUTHORIZE = GH_BASE + '/login/oauth/authorize';
const GH_TOKEN = GH_BASE + '/login/oauth/access_token';
const GH_USER = (process.env.GITHUB_API_BASE || 'https://api.github.com') + '/user';
const OAUTH_STATE_TTL = 10 * 60 * 1000;

/** 授权请求的 state → { 模式, 发起的本地账号, 过期时间 }；一次性、10 分钟有效 */
const oauthStates = new Map<string, { mode: 'login' | 'bind'; username: string; expires: number }>();

/** 验证码校验失败时的文案键（前端直接 tr 出来显示） */
function captchaErrorKey(r: captcha.VerifyResult): string {
  return r === 'expired' ? 'api.captcha.expired' : 'api.captcha.wrong';
}

/** GitHub 取数失败的原因码 → 前端文案键 */
function githubErrorKey(code: string): string {
  if (code === 'rate_limited') return 'github.rateLimited';
  if (code === 'not_found') return 'github.notFound';
  return 'github.failed';
}

function githubConfig(): { clientId: string; secret: string } {
  return { clientId: appconfig.get(GH_CFG_ID), secret: appconfig.get(GH_CFG_SECRET) };
}

/** 配置是否完整（只有 id + secret 都有，入口才可用） */
function githubEnabled(): boolean {
  const c = githubConfig();
  return !!(c.clientId && c.secret);
}

/**
 * OAuth 回调地址。GitHub 应用里填的 Callback URL 必须与此**完全一致**，
 * 管理面板会把它显示出来供管理员复制，避免填错。
 */
function oauthRedirectUri(req: any): string {
  const host = String(req.headers['host'] || 'localhost');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(host) ? 'http' : 'https');
  return proto + '://' + host + '/api/oauth/github/callback';
}

/** 302 跳转，可带一个结果码（前端按码显示提示） */
function redirectTo(res: any, page: string, code?: string): void {
  res.writeHead(302, { Location: code ? page + '?oauth=' + encodeURIComponent(code) : page });
  res.end();
}

function handleApi(req: any, res: any, urlObj: any, pathname: string, ip: string): void {
  const t0 = Date.now();

  // POST /api/register —— 提交注册申请（开放注册，需管理员审核通过后才可登录）
  if (pathname === '/api/register' && req.method === 'POST') {
    readBody(req, 8192).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const name = o && typeof o.name === 'string' ? o.name.trim() : '';
      const pass = o && typeof o.password === 'string' ? o.password : '';
      const email = o && typeof o.email === 'string' ? o.email.trim().slice(0, 190) : '';
      // 图形验证码（注册是开放接口，不拦一手会被脚本刷满待审队列）；管理员可在管理面板关掉
      const cv = captcha.isEnabled('register') ? captcha.verify(o && o.captchaId, o && o.captcha) : 'ok';
      if (cv !== 'ok') {
        sendJSON(res, 400, { ok: false, error: captchaErrorKey(cv) });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      if (!USERNAME_RE.test(name) || !passwordStrength(pass)) {
        sendJSON(res, 400, { ok: false, error: 'api.user.registerFormat' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      // 邮箱必填且格式合法
      if (!EMAIL_RE.test(email)) {
        sendJSON(res, 400, { ok: false, error: 'reg.emailInvalid' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      if (!auth.submitRegistration(name, pass, email)) {
        sendJSON(res, 409, { ok: false, error: 'api.user.nameTaken' });
        logger.write({ ip, method: req.method, url: pathname, status: 409, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      audit.add({ actor: name, action: 'register', detail: auditDetail('log.detail.register', { name }), ip });
      sendJSON(res, 200, { ok: true, message: 'api.register.submitted' });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/login
  if (pathname === '/api/login' && req.method === 'POST') {
    if (auth.isLocked(ip)) {
      audit.add({ actor: '', action: 'login.fail', detail: auditDetail('log.detail.login.fail.rateLimited'), ip });
      sendJSON(res, 429, { ok: false, error: 'api.login.rateLimited' });
      logger.write({ ip, method: req.method, url: pathname, status: 429, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    readBody(req, 8192).then((body) => {
      let u!: string; let p!: string;
      let cid: any; let ctext: any;
      try { ({ username: u, password: p, captchaId: cid, captcha: ctext } = JSON.parse(body.toString('utf8'))); } catch (e) { /* 解析失败走下面校验 */ }
      if (typeof u !== 'string' || typeof p !== 'string') {
        auth.recordFail(ip);
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      // 图形验证码：同样计入失败次数，防止用「换账号 + 猜验证码」绕过密码限流
      const cap = captcha.isEnabled('login') ? captcha.verify(cid, ctext) : 'ok';
      if (cap !== 'ok') {
        auth.recordFail(ip);
        audit.add({ actor: u.trim(), action: 'login.fail', detail: auditDetail('log.detail.login.fail.captcha'), ip });
        sendJSON(res, 400, { ok: false, error: captchaErrorKey(cap) });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const user = auth.login(u.trim(), p);
      if (!user) {
        auth.recordFail(ip);
        audit.add({ actor: u.trim(), action: 'login.fail', detail: auditDetail('log.detail.login.fail.bad'), ip });
        sendJSON(res, 401, { ok: false, error: 'api.login.badCredentials' });
        logger.write({ ip, method: req.method, url: pathname, status: 401, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      // 未激活账号禁止登录（管理员审核通过前不可用）
      if (user.status !== auth.STATUS.ACTIVE) {
        audit.add({ actor: u.trim(), action: 'login.fail', detail: auditDetail(user.status === auth.STATUS.PENDING ? 'log.detail.login.blockedPending' : 'log.detail.login.blockedRejected'), ip });
        sendJSON(res, 403, { ok: false, error: user.status === auth.STATUS.PENDING ? '账号待管理员审核，通过后才能登录' : '账号已被拒绝，无法登录' });
        logger.write({ ip, method: req.method, url: pathname, status: 403, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      // 被封禁 / IP 被封禁：禁止登录
      const block = moderate.blockFor(user.username, ip);
      if (block.banned) {
        audit.add({ actor: user.username, action: 'login.blocked', detail: auditDetail(block.ipBanned ? 'log.detail.login.blockedIp' : 'log.detail.login.blockedBan'), ip });
        sendJSON(res, 403, { ok: false, error: block.ipBanned ? 'api.login.ipBanned' : 'api.login.banned' });
        logger.write({ ip, method: req.method, url: pathname, status: 403, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      // 开启了两步验证：先下发 2FA 挑战，验证通过后再建立会话
      const twofa = auth.getTotp(user.username);
      if (twofa.enabled) {
        const challenge = crypto.randomBytes(24).toString('hex');
        twofaChallenges.set(challenge, { username: user.username, expires: Date.now() + 5 * 60 * 1000 });
        audit.add({ actor: user.username, action: 'login.2fa', detail: auditDetail('log.detail.login.need2fa'), ip });
        sendJSON(res, 200, { ok: true, need2fa: true, challenge });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const token = auth.createSession(user.username, ip);
      auth.clearFails(ip);
      audit.add({ actor: user.username, action: 'login', detail: auditDetail('log.detail.login.ok'), ip });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': 'circlechat_token=' + encodeURIComponent(token) +
          '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (7 * 24 * 3600)
      });
      res.end(JSON.stringify({ ok: true, username: user.username, mustChange: !!(user.mustChange) }));
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/logout
  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = auth.tokenFromCookie(req.headers.cookie);
    const sess = token ? auth.getSession(token) : null;
    if (sess) audit.add({ actor: sess.username, action: 'logout', detail: auditDetail('log.detail.logout'), ip });
    if (token) auth.destroySession(token);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'circlechat_token=; Path=/; HttpOnly; Max-Age=0'
    });
    res.end(JSON.stringify({ ok: true }));
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/health（公开探活）
  if (pathname === '/api/health' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
    return;
  }

  // GET /api/setup（公开：内置管理员是否仍用默认密码，供登录页提示）
  // GET /api/captcha?scope=login|register&dark=0|1 —— 取一张图形验证码（免登录：登录页要用）
  // 该页面被管理员关掉人机验证时返回 { enabled: false } 且**不生成**验证码（前端据此隐藏输入框）
  if (pathname === '/api/captcha' && req.method === 'GET') {
    const scope: captcha.CaptchaScope = urlObj.searchParams.get('scope') === 'register' ? 'register' : 'login';
    const dark = urlObj.searchParams.get('dark') === '1';
    // 验证码图不能缓存：否则浏览器拿到上一张，用户输的却是眼前这张
    res.setHeader('Cache-Control', 'no-store');
    if (!captcha.isEnabled(scope)) {
      sendJSON(res, 200, { ok: true, enabled: false });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    const c = captcha.create(dark);
    sendJSON(res, 200, { ok: true, enabled: true, id: c.id, svg: c.svg });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  if (pathname === '/api/setup' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, defaultAdmin: auth.defaultAdminPassword() });
    return;
  }

  // POST /api/twofa/verify（公开：登录第二步两步验证）
  if (pathname === '/api/twofa/verify' && req.method === 'POST') {
    readBody(req, 8192).then((body) => {
      let challenge!: string; let code!: string;
      try { ({ challenge, code } = JSON.parse(body.toString('utf8'))); } catch (e) { /* 走下面校验 */ }
      const ch = twofaChallenges.get(challenge);
      if (!ch || Date.now() > ch.expires) {
        if (ch) twofaChallenges.delete(challenge);
        sendJSON(res, 400, { ok: false, error: 'twofa.challengeExpired' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      if (auth.isLocked(ip)) {
        sendJSON(res, 429, { ok: false, error: 'api.login.rateLimited' });
        logger.write({ ip, method: req.method, url: pathname, status: 429, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const stored = auth.getTotp(ch.username);
      if (!stored.secret || !auth.verifyTotp(stored.secret, code)) {
        auth.recordFail(ip);
        audit.add({ actor: ch.username, action: 'login.fail', detail: auditDetail('log.detail.login.fail.twofa'), ip });
        sendJSON(res, 401, { ok: false, error: 'twofa.badCode' });
        logger.write({ ip, method: req.method, url: pathname, status: 401, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      twofaChallenges.delete(challenge);
      auth.clearFails(ip);
      const token = auth.createSession(ch.username, ip);
      audit.add({ actor: ch.username, action: 'login', detail: auditDetail('log.detail.login.ok'), ip });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': 'circlechat_token=' + encodeURIComponent(token) +
          '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (7 * 24 * 3600)
      });
      res.end(JSON.stringify({ ok: true, username: ch.username, mustChange: auth.mustChange(ch.username) }));
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // GET /api/app-manifest —— 公开：给桌面应用下发的应用清单（标识 + 版本 + 时间戳 + 服务端签名）
  // 放在鉴权门槛之前：桌面应用不带本站会话 Cookie，走不了登录态。
  // 签名密钥取自环境变量 APP_SECRET，只用于计算签名、绝不下发。
  if (pathname === '/api/app-manifest') {
    // 跨域预检：桌面应用若带自定义请求头（非简单请求），浏览器/客户端会先发 OPTIONS
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...APP_MANIFEST_CORS, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      sendJSON(res, 405, { ok: false, error: 'method_not_allowed' }, APP_MANIFEST_CORS);
      logger.write({ ip, method: req.method, url: pathname, status: 405, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    const secret = process.env.APP_SECRET || '';
    if (!secret) {
      // 未配置密钥就一份都不发：宁可接口不可用，也不给出无签名（可被伪造）的清单
      sendJSON(res, 503, { ok: false, error: 'app_secret_not_configured' }, APP_MANIFEST_CORS);
      logger.write({ ip, method: req.method, url: pathname, status: 503, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    const timestamp = Math.floor(Date.now() / 1000); // Unix 时间戳（秒）
    // 按约定：sha256(app_id + version + timestamp + APP_SECRET)
    const signature = crypto.createHash('sha256')
      .update(APP_INFO.id + APP_INFO.version + timestamp + secret)
      .digest('hex');
    sendJSON(res, 200, {
      app_id: APP_INFO.id,
      version: APP_INFO.version,
      timestamp,
      signature
    }, APP_MANIFEST_CORS);
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/oauth/providers —— 公开：登录页据此决定要不要显示「用 GitHub 登录」
  if (pathname === '/api/oauth/providers' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, github: { enabled: githubEnabled() } });
    return;
  }

  // GET /api/oauth/github/start?mode=login|bind —— 跳到 GitHub 授权页
  if (pathname === '/api/oauth/github/start' && req.method === 'GET') {
    const gh = githubConfig();
    if (!gh.clientId || !gh.secret) { redirectTo(res, '/login.html', 'notconfigured'); return; }
    const mode = urlObj.searchParams.get('mode') === 'bind' ? 'bind' : 'login';
    const who = auth.authByCookie(req.headers.cookie);
    if (mode === 'bind' && !who) { redirectTo(res, '/login.html'); return; } // 绑定必须已登录
    // 顺手清掉过期 state，避免 Map 越积越大
    const now = Date.now();
    for (const [k, v] of oauthStates) if (v.expires < now) oauthStates.delete(k);
    const state = crypto.randomBytes(24).toString('hex');
    oauthStates.set(state, { mode, username: who ? who.username : '', expires: now + OAUTH_STATE_TTL });
    const u = new URL(GH_AUTHORIZE);
    u.searchParams.set('client_id', gh.clientId);
    u.searchParams.set('redirect_uri', oauthRedirectUri(req));
    u.searchParams.set('scope', 'read:user');
    u.searchParams.set('state', state);
    res.writeHead(302, { Location: u.toString() });
    res.end();
    logger.write({ ip, method: req.method, url: pathname, status: 302, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/oauth/github/callback?code=&state= —— GitHub 授权后的回调
  if (pathname === '/api/oauth/github/callback' && req.method === 'GET') {
    void (async () => {
      const gh = githubConfig();
      const state = String(urlObj.searchParams.get('state') || '');
      const st = oauthStates.get(state);
      oauthStates.delete(state); // 一次性：无论成败都作废，防重放
      const page = st && st.mode === 'bind' ? '/chat.html' : '/login.html';
      const fail = (why: string): void => {
        redirectTo(res, page, why);
        logger.write({ ip, method: req.method, url: pathname, status: 302, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      };
      if (!gh.clientId || !gh.secret) { fail('notconfigured'); return; }
      // state 校验：同时挡住 CSRF 与过期请求
      if (!st || st.expires < Date.now()) { fail('state'); return; }
      if (urlObj.searchParams.get('error')) { fail('denied'); return; } // 用户在 GitHub 上点了取消
      const code = String(urlObj.searchParams.get('code') || '');
      if (!code) { fail('failed'); return; }
      try {
        const tokRes = await fetch(GH_TOKEN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            client_id: gh.clientId,
            client_secret: gh.secret,
            code,
            redirect_uri: oauthRedirectUri(req)
          })
        });
        const tok = (await tokRes.json()) as { access_token?: string };
        if (!tok || !tok.access_token) { fail('failed'); return; }
        const uRes = await fetch(GH_USER, {
          headers: {
            Authorization: 'Bearer ' + tok.access_token,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'CircleChat'
          }
        });
        const gu = (await uRes.json()) as { id?: number; login?: string };
        const ghId = gu && gu.id ? String(gu.id) : '';
        if (!ghId) { fail('failed'); return; }
        const ghLogin = String(gu.login || '');
        // access_token 只用来拿身份，不落地存储（最小权限）
        if (st.mode === 'bind') {
          const owner = auth.findByGithubId(ghId);
          if (owner && owner !== st.username) { fail('taken'); return; } // 已被别的账号绑走
          auth.setGithubLink(st.username, ghId, ghLogin);
          audit.add({ actor: st.username, action: 'oauth.bind', detail: auditDetail('log.detail.oauth.bind', { login: ghLogin }), ip });
          redirectTo(res, '/chat.html', 'bound');
          logger.write({ ip, method: req.method, url: pathname, status: 302, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        // 登录模式：GitHub 账号必须已绑定到某个本地账号
        const name = auth.findByGithubId(ghId);
        if (!name) { fail('nobind'); return; }
        const u = auth.loadUsers()[name];
        // status 为 NULL 视为正常（内置 admin 就是这种老记录），与 auth.login() 保持一致
        const st2 = u && u.status != null ? u.status : auth.STATUS.ACTIVE;
        if (!u || st2 !== auth.STATUS.ACTIVE) { fail('blocked'); return; }
        if (moderate.blockFor(name, ip).banned) { fail('banned'); return; }
        // 开了两步验证的账号不允许走第三方登录：否则等于绕过了第二因子
        if (auth.getTotp(name).enabled) { fail('2fa'); return; }
        const token = auth.createSession(name, ip);
        audit.add({ actor: name, action: 'oauth.login', detail: auditDetail('log.detail.oauth.login', { login: ghLogin }), ip });
        res.writeHead(302, {
          Location: '/chat.html',
          'Set-Cookie': 'circlechat_token=' + encodeURIComponent(token) +
            '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (7 * 24 * 3600)
        });
        res.end();
        logger.write({ ip, method: req.method, url: pathname, status: 302, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      } catch (e) {
        // 网络异常 / GitHub 返回非 JSON 等：一律按失败处理，不把内部错误抛给用户
        console.error('[oauth] GitHub 授权流程失败：', e);
        fail('failed');
      }
    })();
    return;
  }

  // 以下接口均需登录
  const me = auth.authByCookie(req.headers.cookie);
  if (!me) {
    sendJSON(res, 401, { ok: false, error: 'api.unauthorized' });
    logger.write({ ip, method: req.method, url: pathname, status: 401, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/me
  if (pathname === '/api/me' && req.method === 'GET') {
    const online = currentPresent();
    sendJSON(res, 200, {
      ok: true,
      username: me.username,
      role: auth.getRole(me.username),
      online,
      away: currentAway(),
      platforms: currentPlatforms(), // 在线用户的连接来源（网页端 / 桌面客户端）
      lastSeen: lastSeenSnapshot(), // 用户名 -> 最后在线时间（ms）
      mustChange: auth.mustChange(me.username),
      totpEnabled: auth.getTotp(me.username).enabled
    });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/oauth/me —— 当前账号的第三方登录状态（个人资料页用；不含任何密钥）
  if (pathname === '/api/oauth/me' && req.method === 'GET') {
    sendJSON(res, 200, {
      ok: true,
      github: { enabled: githubEnabled(), login: auth.getGithubLogin(me.username) }
    });
    return;
  }

  // POST /api/oauth/github/unbind —— 解除 GitHub 绑定（解绑后仍可用账号密码登录）
  if (pathname === '/api/oauth/github/unbind' && req.method === 'POST') {
    auth.setGithubLink(me.username, null, null);
    audit.add({ actor: me.username, action: 'oauth.unbind', detail: auditDetail('log.detail.oauth.unbind'), ip });
    sendJSON(res, 200, { ok: true });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/me/penalties —— 我的处罚（本人账号 + 当前 IP；供个人资料页展示）
  if (pathname === '/api/me/penalties' && req.method === 'GET') {
    const penalties = moderate.listPenaltiesFor(me.username, ip);
    const status = moderate.statusOf(me.username, ip);
    sendJSON(res, 200, { ok: true, penalties, status });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/announcements —— 系统公告（全局，登录可见）
  if (pathname === '/api/announcements' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, announcements: mailbox.listAnnouncements() });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/me/notifications —— 我的通知
  if (pathname === '/api/me/notifications' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, notifications: mailbox.listNotificationsFor(me.username) });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/me/notifications/read —— 全部标记已读
  if (pathname === '/api/me/notifications/read' && req.method === 'POST') {
    const n = mailbox.markNotificationsRead(me.username);
    sendJSON(res, 200, { ok: true, marked: n });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/pass（本人修改密码，需校验当前密码；用于首次登录强制改密与日常自助改密）
  if (pathname === '/api/pass' && req.method === 'POST') {
    readBody(req, 8192).then((body) => {
      let cur!: string; let np!: string;
      try { ({ current: cur, password: np } = JSON.parse(body.toString('utf8'))); } catch (e) { /* 解析失败走下面校验 */ }
      if (typeof cur !== 'string' || typeof np !== 'string') {
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      if (!auth.login(me.username, cur)) {
        sendJSON(res, 400, { ok: false, error: 'pass.currentWrong' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      if (!passwordStrength(np)) {
        sendJSON(res, 400, { ok: false, error: 'reg.short' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      auth.setPassword(me.username, np);
      // 改密后必须重新登录：销毁该账号全部会话，并让其其它在线设备立即下线
      // （当前这条连接由前端自行跳转登录页，故用 exceptToken 跳过）
      const closed = auth.destroyUserSessions(me.username);
      forceLogout(me.username, me.token);
      audit.add({ actor: me.username, action: 'self.pass', detail: auditDetail('log.detail.user.pass', { name: me.username }), ip });
      sendJSON(res, 200, { ok: true, sessionsClosed: closed });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/profile（本人修改资料：改名 {name} / 改头像 {image}）
  if (pathname === '/api/profile' && req.method === 'POST') {
    readBody(req, 16384).then((body) => {
      let obj: any;
      try { obj = JSON.parse(body.toString('utf8')); } catch (e) { obj = null; }
      if (obj && typeof obj.name === 'string') {
        const name = obj.name.trim();
        if (!USERNAME_RE.test(name)) {
          sendJSON(res, 400, { ok: false, error: 'api.user.nameFormat' });
          logger.write({ ip, method: req.method, url: pathname, status:400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        if (name === me.username) {
          sendJSON(res, 200, { ok: true, newName: name });
          logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        // 内置管理员不允许改名：ensureAdmin() 会在它不存在时用默认密码重建，改名等于挖一个后门
        if (me.username === 'admin') {
          sendJSON(res, 400, { ok: false, error: 'api.admin.cannotRenameAdmin' });
          logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        if (!auth.renameUser(me.username, name)) {
          sendJSON(res, 400, { ok: false, error: 'api.user.nameTaken' });
          logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        auth.renameSession(me.username, name);
        audit.add({ actor: me.username, action: 'user.rename', detail: auditDetail('log.detail.user.rename', { old: me.username, name }), ip });
        sendJSON(res, 200, { ok: true, newName: name });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      if (obj && typeof obj.image === 'string') {
        const image = obj.image.trim();
        if (image !== '' && !/^\/uploads\/[a-zA-Z0-9]+\.[a-zA-Z0-9]{1,8}$/.test(image)) {
          sendJSON(res, 400, { ok: false, error: 'api.user.imageInvalid' });
          logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        auth.setImage(me.username, image);
        audit.add({ actor: me.username, action: 'user.image', detail: auditDetail('log.detail.user.image'), ip });
        sendJSON(res, 200, { ok: true, image });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
      logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/twofa/setup（本人：生成两步验证密钥）
  if (pathname === '/api/twofa/setup' && req.method === 'POST') {
    const st = auth.getTotp(me.username);
    if (st.enabled) {
      sendJSON(res, 400, { ok: false, error: 'twofa.alreadyOn' });
      logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    const secret = auth.genSecret();
    auth.setTotpEnabled(me.username, false, secret);
    audit.add({ actor: me.username, action: 'twofa.setup', detail: auditDetail('log.detail.twofa.setup'), ip });
    sendJSON(res, 200, { ok: true, secret, otpauth: auth.otpauthURL(me.username, secret) });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/twofa/enable（本人：验证验证码后启用两步验证）
  if (pathname === '/api/twofa/enable' && req.method === 'POST') {
    readBody(req, 8192).then((body) => {
      let code!: string;
      try { ({ code } = JSON.parse(body.toString('utf8'))); } catch (e) { /* 走下面校验 */ }
      const st = auth.getTotp(me.username);
      if (st.enabled) {
        sendJSON(res, 400, { ok: false, error: 'twofa.alreadyOn' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      if (!st.secret || !auth.verifyTotp(st.secret, code)) {
        sendJSON(res, 400, { ok: false, error: 'twofa.badCode' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      auth.setTotpEnabled(me.username, true, st.secret);
      audit.add({ actor: me.username, action: 'twofa.enable', detail: auditDetail('log.detail.twofa.enable'), ip });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/twofa/disable（本人：验证验证码后关闭两步验证）
  if (pathname === '/api/twofa/disable' && req.method === 'POST') {
    readBody(req, 8192).then((body) => {
      let code!: string;
      try { ({ code } = JSON.parse(body.toString('utf8'))); } catch (e) { /* 走下面校验 */ }
      const st = auth.getTotp(me.username);
      if (!st.enabled) {
        sendJSON(res, 400, { ok: false, error: 'twofa.alreadyOff' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      if (!st.secret || !auth.verifyTotp(st.secret, code)) {
        sendJSON(res, 400, { ok: false, error: 'twofa.badCode' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      auth.setTotpEnabled(me.username, false, null);
      audit.add({ actor: me.username, action: 'twofa.disable', detail: auditDetail('log.detail.twofa.disable'), ip });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // GET /api/users（全部有效账号 + 头像配置，用于成员列表/搜索；不含待审核及被拒账号，含自己）
  if (pathname === '/api/users' && req.method === 'GET') {
    const q = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
    const raw = auth.loadUsers() || {};
    const users = Object.keys(raw)
      .filter((name) => {
        const status = raw[name].status || auth.STATUS.ACTIVE;
        if (status !== auth.STATUS.ACTIVE) return false; // 隐藏 pending / rejected 账号
        return q === '' || String(name).toLowerCase().indexOf(q) !== -1;
      })
      .sort()
      .map((name) => ({ name, image: raw[name].image || null, lastSeen: ensureLastSeen()[name] || null }));
    sendJSON(res, 200, { ok: true, users });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // ---------- 好友接口 ----------

  // 带在线/头像装饰的用户名列表
  function decorateNames(names: string[]): { name: string; online: boolean; image?: string; lastSeen: number | null }[] {
    const raw = auth.loadUsers() || {};
    const online = new Set(currentPresent());
    return names.map(function (n) {
      const o: { name: string; online: boolean; image?: string; lastSeen: number | null } = {
        name: n,
        online: online.has(n),
        lastSeen: ensureLastSeen()[n] || null
      };
      if (raw[n] && raw[n].image) o.image = raw[n].image;
      return o;
    });
  }

  // GET /api/friends —— 好友 / 收到的申请 / 已发出的申请
  if (pathname === '/api/friends' && req.method === 'GET') {
    sendJSON(res, 200, {
      ok: true,
      friends: decorateNames(friends.listFriends(me.username)),
      requests: friends.listRequests(me.username),
      sent: friends.listSent(me.username)
    });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/friends/request —— 发送好友申请 {to}
  if (pathname === '/api/friends/request' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const to = o && typeof o.to === 'string' ? o.to.trim() : '';
      if (!to || to.length > 64 || to === me.username) {
        sendJSON(res, 400, { ok: false, error: 'api.friend.invalidPeer' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const raw = auth.loadUsers() || {};
      if (!Object.prototype.hasOwnProperty.call(raw, to)) {
        sendJSON(res, 404, { ok: false, error: 'api.user.notFound' });
        logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const r = friends.sendRequest(me.username, to);
      if (!r.ok) {
        sendJSON(res, 409, { ok: false, error: r.reason || 'api.friend.sendFailed' });
        logger.write({ ip, method: req.method, url: pathname, status: 409, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      audit.add({ actor: me.username, action: 'friend.request', target: to, detail: auditDetail('log.detail.friend.request', { name: to }), ip });
      broadcast({ type: 'friends.changed' });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/friends/accept —— 同意好友申请 {from}
  if (pathname === '/api/friends/accept' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const from = o && typeof o.from === 'string' ? o.from.trim() : '';
      if (!from || !friends.acceptRequest(me.username, from)) {
        sendJSON(res, 404, { ok: false, error: 'api.friend.reqGone' });
        logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      audit.add({ actor: me.username, action: 'friend.accept', target: from, detail: auditDetail('log.detail.friend.accept', { name: from }), ip });
      broadcast({ type: 'friends.changed' });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/friends/decline —— 拒绝/删除好友申请 {from}
  if (pathname === '/api/friends/decline' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const from = o && typeof o.from === 'string' ? o.from.trim() : '';
      if (!from) { sendJSON(res, 400, { ok: false, error: 'api.invalidParams' }); return; }
      friends.declineRequest(me.username, from);
      broadcast({ type: 'friends.changed' });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }
  if (pathname === '/api/profile' && req.method === 'GET') {
    const name = (urlObj.searchParams.get('name') || '').trim();
    const raw = auth.loadUsers() || {};
    if (!name || !Object.prototype.hasOwnProperty.call(raw, name)) {
      sendJSON(res, 404, { ok: false, error: 'api.user.notFound' });
      logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    const online = new Set(currentPresent());
    const counts = store.countByUser();
    sendJSON(res, 200, {
      ok: true,
      name,
      role: raw[name].role === 'admin' ? 'admin' : 'user',
      created: raw[name].created || null,
      image: raw[name].image || null,
      online: online.has(name),
      msgs: counts[name] || 0
    });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/settings（当前用户设置）
  if (pathname === '/api/settings' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, settings: auth.getSettings(me.username) });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/settings（保存设置，白名单字段校验）
  if (pathname === '/api/settings' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let patch: any;
      try { patch = JSON.parse(body.toString('utf8')); } catch (e) { patch = null; }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
        return;
      }
      if (patch.notify !== undefined && typeof patch.notify !== 'boolean') {
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
        return;
      }
      if (patch.sendKey !== undefined && patch.sendKey !== 'enter' && patch.sendKey !== 'ctrl') {
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
        return;
      }
      if (patch.notifySound !== undefined &&
          (typeof patch.notifySound !== 'string' ||
           patch.notifySound.length > 128 ||
           !/^[a-zA-Z0-9._-]+\.mp3$/.test(patch.notifySound))) {
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
        return;
      }
      // 收发提示音各自的开关
      if (patch.soundIn !== undefined && typeof patch.soundIn !== 'boolean') {
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
        return;
      }
      if (patch.soundOut !== undefined && typeof patch.soundOut !== 'boolean') {
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
        return;
      }
      // 媒体播放音量：0~1 的数（越界 / 非数一律拒绝，免得存进去一个把玩家静音的值）
      if (patch.volume !== undefined &&
          (typeof patch.volume !== 'number' || !Number.isFinite(patch.volume) ||
           patch.volume < 0 || patch.volume > 1)) {
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
        return;
      }
      auth.setSettings(me.username, patch);
      audit.add({ actor: me.username, action: 'settings', detail: auditDetail('log.detail.settings', { json: JSON.stringify(patch) }), ip });
      sendJSON(res, 200, { ok: true, settings: auth.getSettings(me.username) });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/report —— 举报一条消息 {idx, reason}（任何登录用户）
  if (pathname === '/api/report' && req.method === 'POST') {
    readBody(req, 4096).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const idx = Number(o && o.idx);
      const reason = o && typeof o.reason === 'string' ? o.reason.trim().slice(0, 200) : '';
      if (!Number.isInteger(idx) || idx <= 0) { sendJSON(res, 400, { ok: false, error: 'api.invalidParams' }); return; }
      const target = store.get(idx);
      if (!target || target.recalled) { sendJSON(res, 404, { ok: false, error: 'mod.msgGone' }); return; }
      if (target.from === me.username) { sendJSON(res, 400, { ok: false, error: 'mod.selfReport' }); return; }
      if (!reason) { sendJSON(res, 400, { ok: false, error: 'mod.reasonRequired' }); return; }
      const snippet = target.type === 'text'
        ? String(target.content || '').slice(0, 200)
        : (target.type === 'image' ? '[图片]' : '[文件]' + (target.name ? ' ' + target.name : ''));
      // 被举报者在线上传的 IP（用于可能的 IP 封禁）；离线则无
      let reportedIp: string | null = null;
      for (const c of clients) {
        if (c.user && c.user.username === target.from) {
          reportedIp = c.user.ip; break;
        }
      }
      moderate.reportMessage(me.username, { idx, from: target.from, type: target.type, snippet, ip: reportedIp }, reason);
      audit.add({ actor: me.username, action: 'msg.report', target: idx, detail: auditDetail('log.detail.report', { user: target.from }), ip });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // ---------- 管理员接口（仅 role=admin 可用） ----------

  if (pathname.indexOf('/api/admin/') === 0) {
    if (!auth.isAdmin(me.username)) {
      sendJSON(res, 403, { ok: false, error: 'api.admin.forbidden' });
      logger.write({ ip, method: req.method, url: pathname, status: 403, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }

    // GET /api/admin/captcha —— 人机验证开关（登录页 / 注册页各一个）
    if (pathname === '/api/admin/captcha' && req.method === 'GET') {
      sendJSON(res, 200, { ok: true, login: captcha.isEnabled('login'), register: captcha.isEnabled('register') });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }

    // POST /api/admin/captcha —— 保存人机验证开关 {login?: boolean, register?: boolean}
    if (pathname === '/api/admin/captcha' && req.method === 'POST') {
      readBody(req, 1024).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验走下面 */ }
        if (!o || typeof o !== 'object' ||
            (o.login !== undefined && typeof o.login !== 'boolean') ||
            (o.register !== undefined && typeof o.register !== 'boolean')) {
          sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
          logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        if (typeof o.login === 'boolean') captcha.setEnabled('login', o.login);
        if (typeof o.register === 'boolean') captcha.setEnabled('register', o.register);
        const state = { login: captcha.isEnabled('login'), register: captcha.isEnabled('register') };
        audit.add({
          actor: me.username,
          action: 'admin.captcha',
          target: 'captcha',
          detail: auditDetail('log.detail.captcha', {
            login: state.login ? '✓' : '✕',
            register: state.register ? '✓' : '✕'
          }),
          ip
        });
        sendJSON(res, 200, { ok: true, login: state.login, register: state.register });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // GET /api/admin/oauth —— 第三方登录配置（secret 只回报「是否已设置」，永不下发）
    if (pathname === '/api/admin/oauth' && req.method === 'GET') {
      const gh = githubConfig();
      sendJSON(res, 200, {
        ok: true,
        github: { clientId: gh.clientId, hasSecret: !!gh.secret, redirectUri: oauthRedirectUri(req) }
      });
      return;
    }

    // POST /api/admin/oauth —— 保存 GitHub OAuth 配置 {clientId, secret?, clear?}
    // secret 留空表示「不修改」，免得每次保存都要重填；clear:true 清空全部配置。
    if (pathname === '/api/admin/oauth' && req.method === 'POST') {
      readBody(req, 4096).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 走下面校验 */ }
        if (!o || typeof o !== 'object') {
          sendJSON(res, 400, { ok: false, error: 'api.badRequest' });
          return;
        }
        if (o.clear) {
          appconfig.set(GH_CFG_ID, '');
          appconfig.set(GH_CFG_SECRET, '');
        } else {
          const id = typeof o.clientId === 'string' ? o.clientId.trim().slice(0, 64) : '';
          const secret = typeof o.secret === 'string' ? o.secret.trim().slice(0, 128) : '';
          if (!/^[A-Za-z0-9_.-]{4,64}$/.test(id)) {
            sendJSON(res, 400, { ok: false, error: 'admin.oauth.badId' });
            return;
          }
          if (secret && !/^[A-Za-z0-9_.-]{8,128}$/.test(secret)) {
            sendJSON(res, 400, { ok: false, error: 'admin.oauth.badSecret' });
            return;
          }
          appconfig.set(GH_CFG_ID, id);
          if (secret) appconfig.set(GH_CFG_SECRET, secret);
        }
        audit.add({ actor: me.username, action: 'oauth.config', detail: auditDetail('log.detail.oauth.config'), ip });
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // GET /api/admin/reports?status= —— 举报列表（按时间倒序）
    if (pathname === '/api/admin/reports' && req.method === 'GET') {
      const status = urlObj.searchParams.get('status') || '';
      const items = moderate.listReports(status || undefined);
      sendJSON(res, 200, { ok: true, reports: items });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }

    // POST /api/admin/reports/dismiss —— 忽略举报 {id}
    if (pathname === '/api/admin/reports/dismiss' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const id = Number(o && o.id);
        if (!Number.isInteger(id) || id <= 0) { sendJSON(res, 400, { ok: false, error: 'api.invalidParams' }); return; }
        if (!moderate.dismissReport(id, me.username)) { sendJSON(res, 404, { ok: false, error: 'mod.reportGone' }); return; }
        audit.add({ actor: me.username, action: 'mod.dismiss', target: id, detail: '', ip });
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // POST /api/admin/reports/punish —— 依举报处罚其消息作者 {id,type,days?,permanent?,reason?}
    if (pathname === '/api/admin/reports/punish' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const id = Number(o && o.id);
        if (!Number.isInteger(id) || id <= 0) { sendJSON(res, 400, { ok: false, error: 'api.invalidParams' }); return; }
        const res2 = moderate.punishFromReport(id, me.username,
          (o && String(o.type)) || '', Number(o && o.days), !!o.permanent, (o && o.reason) || '');
        if (!res2.ok) { sendJSON(res, 400, { ok: false, error: res2.code }); return; }
        audit.add({ actor: me.username, action: 'mod.punish', target: id, detail: auditDetail('log.detail.punish', { type: o.type, id: res2.id }), ip });
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // GET /api/admin/penalties —— 处罚列表
    if (pathname === '/api/admin/penalties' && req.method === 'GET') {
      sendJSON(res, 200, { ok: true, penalties: moderate.listPenalties() });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }

    // POST /api/admin/penalties/add —— 手动新增处罚 {type,target,days?,permanent?,reason?}
    if (pathname === '/api/admin/penalties/add' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const res2 = moderate.addPenalty({
          type: (o && o.type) || '', target: (o && o.target) || '', reason: (o && o.reason) || '',
          days: Number(o && o.days), permanent: !!o.permanent, actor: me.username
        });
        if (!res2.ok) { sendJSON(res, 400, { ok: false, error: res2.code }); return; }
        audit.add({ actor: me.username, action: 'mod.punish', target: res2.id, detail: auditDetail('log.detail.punish', { type: o.type, id: res2.id }), ip });
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // POST /api/admin/penalties/revoke —— 撤销处罚 {id}
    if (pathname === '/api/admin/penalties/revoke' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const id = Number(o && o.id);
        if (!Number.isInteger(id) || id <= 0) { sendJSON(res, 400, { ok: false, error: 'api.invalidParams' }); return; }
        if (!moderate.revokePenalty(id, me.username)) { sendJSON(res, 404, { ok: false, error: 'mod.penaltyGone' }); return; }
        audit.add({ actor: me.username, action: 'mod.revoke', target: id, detail: '', ip });
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // POST /api/admin/announcements —— 发布系统公告 {title,content}
    if (pathname === '/api/admin/announcements' && req.method === 'POST') {
      readBody(req, 8192).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const res2 = mailbox.createAnnouncement({
          title: (o && o.title) || '', content: (o && o.content) || '', actor: me.username
        });
        if (!res2.ok) { sendJSON(res, 400, { ok: false, error: res2.code }); return; }
        sendJSON(res, 200, { ok: true, id: res2.id });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // DELETE /api/admin/announcements —— 删除公告 {id}
    if (pathname === '/api/admin/announcements' && req.method === 'DELETE') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const id = Number(o && o.id);
        if (!Number.isInteger(id) || id <= 0) { sendJSON(res, 400, { ok: false, error: 'api.invalidParams' }); return; }
        if (!mailbox.deleteAnnouncement(id)) { sendJSON(res, 404, { ok: false, error: 'announce.gone' }); return; }
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // GET /api/admin/users —— 用户列表（含角色与在线状态）
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const raw = auth.loadUsers() || {};
      const online = new Set(currentPresent());
      const platforms = currentPlatforms();
      const users = Object.keys(raw).sort().map((name) => ({
        name,
        role: raw[name].role === 'admin' ? 'admin' : 'user',
        status: raw[name].status || auth.STATUS.ACTIVE,
        created: raw[name].created || null,
        image: raw[name].image || null,
        online: online.has(name),
        platform: platforms[name] || null, // 连接来源：网页端 / 桌面客户端 / 两端（离线为 null）
        lastSeen: ensureLastSeen()[name] || null
      }));
      sendJSON(res, 200, { ok: true, users });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }

    // GET /api/admin/approvals —— 待审核注册申请列表
    if (pathname === '/api/admin/approvals' && req.method === 'GET') {
      sendJSON(res, 200, { ok: true, approvals: auth.reviewList() });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }

    // POST /api/admin/review/approve —— 通过注册申请 {name}
    if (pathname === '/api/admin/review/approve' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        if (!name) { sendJSON(res, 400, { ok: false, error: 'api.invalidParams' }); return; }
        if (!auth.reviewApprove(name)) {
          sendJSON(res, 404, { ok: false, error: 'api.friend.reqGone' });
          return;
        }
        audit.add({ actor: me.username, action: 'admin.review.approve', target: name, detail: auditDetail('log.detail.review.approve', { name }), ip });
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // POST /api/admin/review/reject —— 拒绝注册申请 {name}
    if (pathname === '/api/admin/review/reject' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        if (!name) { sendJSON(res, 400, { ok: false, error: 'api.invalidParams' }); return; }
        if (!auth.reviewReject(name)) {
          sendJSON(res, 404, { ok: false, error: 'api.friend.reqGone' });
          return;
        }
        audit.add({ actor: me.username, action: 'admin.review.reject', target: name, detail: auditDetail('log.detail.review.reject', { name }), ip });
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // GET /api/admin/logs —— 审计日志（倒序，支持按用户 / 动作筛选与分页）
    //   ?actions=a,b,c 可一次筛多个动作（管理面板的类别多选）；老的 ?action= 仍然支持
    if (pathname === '/api/admin/logs' && req.method === 'GET') {
      const q = urlObj.searchParams;
      const rawActions: string[] = String(q.get('actions') || '')
        .split(',')
        .map((x: string) => x.trim())
        .filter((x: string) => !!x);
      if (rawActions.length > 100 || rawActions.some((a: string) => !/^[a-zA-Z0-9._]{1,40}$/.test(a))) {
        sendJSON(res, 400, { ok: false, error: 'api.badRequest' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const page = audit.list({
        limit: q.get('limit'),
        offset: q.get('offset'),
        actor: (q.get('actor') || '').trim() || undefined,
        action: (q.get('action') || '').trim() || undefined,
        actions: rawActions.length ? rawActions : undefined
      });
      sendJSON(res, 200, { ok: true, total: page.total, logs: page.logs, max: audit.MAX_LOGS });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }

    // POST /api/admin/user/add —— 新建用户 {name, password, role?}
    if (pathname === '/api/admin/user/add' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        const pass = o && typeof o.password === 'string' ? o.password : '';
        if (!USERNAME_RE.test(name) || !passwordStrength(pass)) {
          sendJSON(res, 400, { ok: false, error: 'api.user.registerFormat' });
          return;
        }
        if (!auth.createUser(name, pass, o.role === 'admin' ? 'admin' : 'user')) {
          sendJSON(res, 409, { ok: false, error: 'api.user.nameTaken' });
          return;
        }
        audit.add({ actor: me.username, action: 'admin.user.add', target: name, detail: auditDetail('log.detail.user.add', { name }), ip });
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // POST /api/admin/user/del —— 删除用户 {name}
    if (pathname === '/api/admin/user/del' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        if (!name) { sendJSON(res, 400, { ok: false, error: 'api.invalidParams' }); return; }
        if (name === me.username) { sendJSON(res, 400, { ok: false, error: 'api.admin.cannotDeleteSelf' }); return; }
        if (name === 'admin') { sendJSON(res, 400, { ok: false, error: 'api.admin.cannotDeleteAdmin' }); return; }
        if (!auth.deleteUser(name)) { sendJSON(res, 404, { ok: false, error: 'api.user.notFound' }); return; }
        groups.removeUserAll(name); // 清理该用户在各群的全部成员关系，避免遗留孤儿
        groups.removeRequestsOfUser(name); // 清理该用户的全部入群申请
        friends.removeUserAll(name); // 清理该用户全部好友关系与好友申请
        broadcast({ type: 'friends.changed' });
        audit.add({ actor: me.username, action: 'admin.user.del', target: name, detail: auditDetail('log.detail.user.del', { name }), ip });
        // 立即断开该用户的所有在线连接
        for (const c of [...clients]) {
          if (c.user.username === name) { try { c.close(); } catch (e) { /* 忽略 */ } }
        }
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // POST /api/admin/user/image —— 设置/清除用户头像 {name, image}
    if (pathname === '/api/admin/user/image' && req.method === 'POST') {
      readBody(req, 4096).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        const image = o && typeof o.image === 'string' ? o.image.trim() : '';
        if (!name) { sendJSON(res, 400, { ok: false, error: '参数错误' }); return; }
        // 仅接受 http(s) 图片地址或留空清除；拒绝 javascript: 等危险协议
        if (image !== '' && !/^https?:\/\/[^\s"'<>]{1,2048}$/i.test(image)) {
          sendJSON(res, 400, { ok: false, error: '头像须为 http(s) 图片地址，或留空清除' });
          return;
        }
        if (!auth.setImage(name, image)) {
          sendJSON(res, 404, { ok: false, error: '用户不存在' });
          return;
        }
        audit.add({ actor: me.username, action: 'admin.user.image', target: name, detail: image ? '设置头像：' + name : '清除头像：' + name, ip });
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: '请求无效' });
      });
      return;
    }

    // POST /api/admin/user/rename —— 修改用户名 {name, newName}
    if (pathname === '/api/admin/user/rename' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        const newName = o && typeof o.newName === 'string' ? o.newName.trim() : '';
        if (!name || !USERNAME_RE.test(newName)) {
          sendJSON(res, 400, { ok: false, error: 'api.user.nameFormat' });
          return;
        }
        if (name === newName) {
          sendJSON(res, 200, { ok: true, newName });
          return;
        }
        // 内置管理员不允许改名（同自助改名）：ensureAdmin() 会用默认密码重建它
        if (name === 'admin') {
          sendJSON(res, 400, { ok: false, error: 'api.admin.cannotRenameAdmin' });
          return;
        }
        // renameUser 会在一个事务里同步 users / messages / dm / reactions / groups / friends 等全部引用
        if (!auth.renameUser(name, newName)) {
          sendJSON(res, 400, { ok: false, error: 'api.user.nameTaken' });
          return;
        }
        auth.renameSession(name, newName); // 会话继续有效：改名不必重新登录
        // 在线连接同步改名，并让该用户的前端刷新自己的身份
        for (const c of [...clients]) {
          if (c.user.username !== name) continue;
          c.user.username = newName;
          try { c.sendText(JSON.stringify({ type: 'me.changed', username: newName })); } catch (e) { /* 忽略 */ }
        }
        broadcast({ type: 'friends.changed' });
        broadcastPresence();
        audit.add({ actor: me.username, action: 'admin.user.rename', target: newName, detail: auditDetail('log.detail.user.rename', { old: name, name: newName }), ip });
        sendJSON(res, 200, { ok: true, newName });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: '请求无效' });
      });
      return;
    }

    // POST /api/admin/user/pass —— 重置密码 {name, password}
    if (pathname === '/api/admin/user/pass' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        const pass = o && typeof o.password === 'string' ? o.password : '';
        if (!name || !passwordStrength(pass)) {
          sendJSON(res, 400, { ok: false, error: 'api.user.passwordTooShort' });
          return;
        }
        if (!auth.setPassword(name, pass)) {
          sendJSON(res, 404, { ok: false, error: 'api.user.notFound' });
          return;
        }
        // 管理员重置他人密码：目标账号必须重新登录（销毁全部会话 + 断开在线连接）
        auth.destroyUserSessions(name);
        forceLogout(name);
        // 管理员「重置他人密码」与本人「修改密码」分开文案，避免混为一类
        audit.add({ actor: me.username, action: 'admin.user.pass', target: name, detail: auditDetail('log.detail.user.passReset', { name }), ip });
        sendJSON(res, 200, { ok: true });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // ---------- 文件管理（全服上传文件） ----------

    // GET /api/admin/files —— 上传文件列表（按修改时间倒序，支持按文件名 / 原始名搜索）
    if (pathname === '/api/admin/files' && req.method === 'GET') {
      const kw = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
      const limit = Math.min(Math.max(parseInt(urlObj.searchParams.get('limit') as string, 10) || 200, 1), 1000);
      const offset = Math.max(parseInt(urlObj.searchParams.get('offset') as string, 10) || 0, 0);
      let names: string[] = [];
      try { names = fs.readdirSync(UPLOAD_DIR); } catch (e) { names = []; } // 目录不存在时按空列表处理
      const usage = store.fileUsage();
      const all: any[] = [];
      for (const n of names) {
        if (!UPLOAD_NAME_RE.test(n)) continue; // 只认本服务器落盘的随机名，忽略 .gitkeep 等无关文件
        let st: any;
        try { st = fs.statSync(path.join(UPLOAD_DIR, n)); } catch (e) { continue; }
        if (!st.isFile()) continue;
        const u = usage.get(n);
        all.push({
          name: n,
          origin: u && u.name ? u.name : '',
          size: st.size,
          ts: Math.floor(st.mtimeMs),
          // 优先用原始文件名判定（落盘名可能被改写，例如伪装成图片的会被降级成 .bin）
          kind: fileKindOf(u && u.name ? u.name : n),
          used: u ? u.count : 0
        });
      }
      const matched = kw
        ? all.filter((f) => f.name.toLowerCase().indexOf(kw) !== -1 || String(f.origin).toLowerCase().indexOf(kw) !== -1)
        : all;
      matched.sort((a: any, b: any) => b.ts - a.ts);
      let totalSize = 0;
      let usedCount = 0;
      for (const f of matched) { totalSize += f.size; if (f.used > 0) usedCount++; }
      sendJSON(res, 200, {
        ok: true,
        total: matched.length,
        files: matched.slice(offset, offset + limit),
        totalSize,
        usedCount,
        limit,
        offset
      });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }

    // POST /api/admin/file/del —— 删除上传文件 {name}
    if (pathname === '/api/admin/file/del' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        if (!UPLOAD_NAME_RE.test(name)) {
          sendJSON(res, 400, { ok: false, error: 'api.admin.fileInvalid' });
          logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        const fp = path.join(UPLOAD_DIR, name);
        // 纵深防御：解析后的真实路径必须仍落在上传目录内
        if (fp !== path.join(UPLOAD_DIR, path.basename(fp))) {
          sendJSON(res, 400, { ok: false, error: 'api.admin.fileInvalid' });
          return;
        }
        let removed = false;
        try {
          if (fs.existsSync(fp)) { fs.unlinkSync(fp); removed = true; }
        } catch (e) { removed = false; }
        if (!removed) {
          sendJSON(res, 404, { ok: false, error: 'api.admin.fileNotFound' });
          logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        store.dropUpload(name); // 去重记录同步移除，之后再传相同内容会重新落盘
        // 仍被消息引用的，标记为已过期：聊天记录显示「图片/文件已过期」，而不是留下打不开的坏链
        const expired = store.expireByFile(name);
        audit.add({ actor: me.username, action: 'admin.file.del', target: name, detail: auditDetail('log.detail.file.del', { name }), ip });
        sendJSON(res, 200, { ok: true, expired });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    // POST /api/admin/files/del-batch —— 批量删除上传文件 {names: []}
    // 逐个走与单删相同的流程（删盘 + 去重记录 + 引用它的消息标记过期），
    // 汇总成一条审计记录；非法名 / 已不存在的计入 failed，不影响其余的删除
    if (pathname === '/api/admin/files/del-batch' && req.method === 'POST') {
      readBody(req, 32768).then((body) => {
        let o: any = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const list = o && Array.isArray(o.names) ? o.names : null;
        if (!list || !list.length) {
          sendJSON(res, 400, { ok: false, error: 'api.badRequest' });
          logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        if (list.length > 200) {
          sendJSON(res, 400, { ok: false, error: 'api.admin.tooManyFiles' });
          logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
        const seen: Record<string, true> = {};
        let deleted = 0;
        let expired = 0;
        const failed: string[] = [];
        for (const raw of list) {
          const name = typeof raw === 'string' ? raw.trim() : '';
          if (!name || seen[name]) continue; // 空值 / 重复项直接跳过
          seen[name] = true;
          if (!UPLOAD_NAME_RE.test(name)) { failed.push(name); continue; }
          const fp = path.join(UPLOAD_DIR, name);
          if (fp !== path.join(UPLOAD_DIR, path.basename(fp))) { failed.push(name); continue; }
          try {
            if (!fs.existsSync(fp)) { failed.push(name); continue; }
            fs.unlinkSync(fp);
          } catch (e) {
            failed.push(name);
            continue;
          }
          store.dropUpload(name);
          expired += store.expireByFile(name);
          deleted++;
        }
        audit.add({
          actor: me.username,
          action: 'admin.file.delBatch',
          target: deleted + ' files',
          detail: auditDetail('log.detail.file.delBatch', { n: deleted }),
          ip
        });
        sendJSON(res, 200, { ok: true, deleted, expired, failed });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      }).catch((e) => {
        sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
      });
      return;
    }

    sendJSON(res, 404, { ok: false, error: 'api.notFound' });
    logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // ---------- 群组接口（需登录） ----------

  // GET /api/groups —— 我的群列表
  if (pathname === '/api/groups' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, groups: groups.listGroupsOf(me.username) });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/groups —— 创建群 {name}
  if (pathname === '/api/groups' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const name = o && typeof o.name === 'string' ? o.name.trim() : '';
      const safeName = /^[\w\u4e00-\u9fa5\-.]{1,24}$/.test(name);
      if (!safeName) {
        sendJSON(res, 400, { ok: false, error: 'api.group.nameFormat' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const g = groups.createGroup(name, me.username);
      audit.add({ actor: me.username, action: 'group.create', target: g.id, detail: auditDetail('log.detail.group.create', { name: g.name }), ip });
      sendJSON(res, 200, { ok: true, id: g.id, name: g.name, owner: g.owner });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // DELETE /api/groups —— 解散群 {gid}（群主或管理员）
  if (pathname === '/api/groups' && req.method === 'DELETE') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const g = groups.getGroup(gid);
      if (!g) { sendJSON(res, 404, { ok: false, error: 'api.group.notFound' }); return; }
      const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
      if (!canManage) { sendJSON(res, 403, { ok: false, error: 'api.group.noDismiss' }); return; }
      store.dissolveMessages(gid);
      groups.dissolveGroup(gid);
      groups.removeRequestsOfGroup(gid); // 清理该群全部待审核/历史的入群申请
      audit.add({ actor: me.username, action: 'group.dissolve', target: gid, detail: auditDetail('log.detail.group.dissolve', { name: g.name }), ip });
      broadcastGid(gid, { type: 'groups.changed', data: { gid } });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // GET /api/groups/members?gid= —— 群成员列表（成员/群主/管理员可见）
  if (pathname === '/api/groups/members' && req.method === 'GET') {
    const gid = (urlObj.searchParams.get('gid') || '').trim() || '';
    if (!groups.getGroup(gid)) { sendJSON(res, 404, { ok: false, error: 'api.group.notFound' }); return; }
    if (!(groups.isMember(gid, me.username) || groups.isOwner(gid, me.username) || auth.isAdmin(me.username))) {
      sendJSON(res, 403, { ok: false, error: 'api.group.noView' });
      return;
    }
    sendJSON(res, 200, { ok: true, gid, members: withLastSeen(groups.groupMembers(gid)) });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/groups/join —— 按 gid 发送入群申请（旧接口兼容，走审核流程）{gid}
  if (pathname === '/api/groups/join' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      if (gid.length > 64 || !groups.getGroup(gid)) {
        sendJSON(res, 404, { ok: false, error: 'api.group.notFound' });
        return;
      }
      const r = groups.requestJoin(gid, me.username);
      if (!r.ok) {
        sendJSON(res, 409, { ok: false, error: r.reason || '无法发送入群申请' });
        return;
      }
      audit.add({ actor: me.username, action: 'group.request', target: gid, detail: auditDetail('log.detail.group.request'), ip });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/groups/leave —— 退出群 {gid}（群主不可退群）
  if (pathname === '/api/groups/leave' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      if (groups.isOwner(gid, me.username)) {
        sendJSON(res, 400, { ok: false, error: 'api.group.ownerCannotLeave' });
        return;
      }
      if (!groups.removeMember(gid, me.username)) {
        sendJSON(res, 404, { ok: false, error: 'api.group.notMember' });
        return;
      }
      audit.add({ actor: me.username, action: 'group.leave', target: gid, detail: auditDetail('log.detail.group.leave'), ip });
      notifyMembersChanged(gid, me.username, 'leave'); // 群里其他人实时看到成员列表变化
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/groups/rename —— 重命名群 {gid, name}（群主或管理员）
  if (pathname === '/api/groups/rename' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const name = o && typeof o.name === 'string' ? o.name.trim() : '';
      const g = groups.getGroup(gid);
      if (!g) { sendJSON(res, 404, { ok: false, error: 'api.group.notFound' }); return; }
      const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
      if (!canManage) { sendJSON(res, 403, { ok: false, error: 'api.group.noRename' }); return; }
      if (!/^[\w\u4e00-\u9fa5\-.]{1,24}$/.test(name)) {
        sendJSON(res, 400, { ok: false, error: 'api.group.nameInvalid' });
        return;
      }
      groups.renameGroup(gid, name);
      audit.add({ actor: me.username, action: 'group.rename', target: gid, detail: auditDetail('log.detail.group.rename', { name }), ip });
      broadcastGid(gid, { type: 'groups.changed', data: { gid } });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/groups/avatar —— 设置群头像 {gid, avatar}（群主或管理员；avatar 为空串清除）
  if (pathname === '/api/groups/avatar' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const avatar = o && typeof o.avatar === 'string' ? o.avatar.trim() : '';
      const g = groups.getGroup(gid);
      if (!g) { sendJSON(res, 404, { ok: false, error: 'api.group.notFound' }); return; }
      const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
      if (!canManage) { sendJSON(res, 403, { ok: false, error: 'api.group.noRename' }); return; }
      const r = groups.setGroupAvatar(gid, avatar);
      if (!r.ok) { sendJSON(res, 400, { ok: false, error: r.code }); return; }
      audit.add({ actor: me.username, action: 'group.avatar', target: gid, detail: '', ip });
      broadcastGid(gid, { type: 'groups.changed', data: { gid } });
      sendJSON(res, 200, { ok: true, avatar: r.avatar });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/groups/announce —— 设置群公告 {gid, text}（群主或管理员；text 为空串清除）
  if (pathname === '/api/groups/announce' && req.method === 'POST') {
    readBody(req, 4096).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const text = o && typeof o.text === 'string' ? o.text : '';
      const g = groups.getGroup(gid);
      if (!g) { sendJSON(res, 404, { ok: false, error: 'api.group.notFound' }); return; }
      const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
      if (!canManage) { sendJSON(res, 403, { ok: false, error: 'api.group.noRename' }); return; }
      groups.setAnnouncement(gid, text);
      audit.add({ actor: me.username, action: 'group.announce', target: gid, detail: '', ip });
      broadcastGid(gid, { type: 'groups.changed', data: { gid } });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // GET /api/groups/search?name= —— 按群名搜索可加入的群（任何登录用户）
  if (pathname === '/api/groups/search' && req.method === 'GET') {
    const name = (urlObj.searchParams.get('name') || '').trim();
    if (!name) { sendJSON(res, 200, { ok: true, groups: [] }); return; }
    sendJSON(res, 200, { ok: true, groups: groups.searchGroups(name) });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/groups/all —— 全部群列表（仅管理员）
  if (pathname === '/api/groups/all' && req.method === 'GET') {
    if (!auth.isAdmin(me.username)) {
      sendJSON(res, 403, { ok: false, error: '无管理员权限' });
      return;
    }
    sendJSON(res, 200, { ok: true, groups: groups.listAllGroups() });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/groups/request —— 按 gid 发送入群申请 {gid}
  if (pathname === '/api/groups/request' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const r = groups.requestJoin(gid, me.username);
      if (!r.ok) {
        sendJSON(res, 409, { ok: false, error: r.reason || '无法发送入群申请' });
        return;
      }
      audit.add({ actor: me.username, action: 'group.request', target: gid, detail: auditDetail('log.detail.group.request'), ip });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: '请求无效' });
    });
    return;
  }

  // GET /api/groups/manage?gid= —— 管理面板数据（群信息/成员/待审核/群文件）
  if (pathname === '/api/groups/manage' && req.method === 'GET') {
    const gid = (urlObj.searchParams.get('gid') || '').trim() || '';
    const g = groups.getGroup(gid);
    if (!g) { sendJSON(res, 404, { ok: false, error: '群不存在' }); return; }
    const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
    if (!canManage) { sendJSON(res, 403, { ok: false, error: '无权管理该群' }); return; }
    sendJSON(res, 200, {
      ok: true,
      group: { id: g.id, name: g.name, owner: g.owner, created: g.created },
      isOwner: groups.isOwner(gid, me.username),
      members: withLastSeen(groups.manageMembers(gid)),
      requests: groups.pendingRequests(gid),
      files: store.filesByRoom(gid, null)
    });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/groups/logs?gid=&limit=&offset= —— 群内操作日志（群主 / 系统管理员）
  // 与全局审计日志同源，但只取 target=gid 的「群管理类」动作：
  // group.msg / group.recall 也把 target 记成 gid，必须排除，否则会被每条消息刷屏。
  if (pathname === '/api/groups/logs' && req.method === 'GET') {
    const gid = (urlObj.searchParams.get('gid') || '').trim() || '';
    if (!groups.getGroup(gid)) { sendJSON(res, 404, { ok: false, error: '群不存在' }); return; }
    const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
    if (!canManage) { sendJSON(res, 403, { ok: false, error: '无权查看该群日志' }); return; }
    const page = audit.list({
      limit: urlObj.searchParams.get('limit'),
      offset: urlObj.searchParams.get('offset'),
      target: gid,
      actionPrefix: 'group.',
      excludeActions: ['group.msg', 'group.recall']
    });
    sendJSON(res, 200, { ok: true, total: page.total, logs: page.logs });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/groups/request/approve —— 通过某人的入群申请 {gid, name}
  if (pathname === '/api/groups/request/approve' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const name = o && typeof o.name === 'string' ? o.name.trim() : '';
      const g = groups.getGroup(gid);
      if (!g) { sendJSON(res, 404, { ok: false, error: '群不存在' }); return; }
      const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
      if (!canManage) { sendJSON(res, 403, { ok: false, error: '无权审核该群' }); return; }
      if (!groups.approveJoin(gid, name)) { sendJSON(res, 404, { ok: false, error: '该申请不存在或已处理' }); return; }
      audit.add({ actor: me.username, action: 'group.request.approve', target: gid, detail: auditDetail('log.detail.group.approve', { name }), ip });
      broadcast({ type: 'groups.changed' }); // 让新成员客户端刷新群列表
      notifyMembersChanged(gid, name, 'join'); // 群内在线的成员实时看到有人加入
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: '请求无效' });
    });
    return;
  }

  // POST /api/groups/request/reject —— 拒绝某人的入群申请 {gid, name}
  if (pathname === '/api/groups/request/reject' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const name = o && typeof o.name === 'string' ? o.name.trim() : '';
      if (!groups.getGroup(gid)) { sendJSON(res, 404, { ok: false, error: '群不存在' }); return; }
      const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
      if (!canManage) { sendJSON(res, 403, { ok: false, error: '无权审核该群' }); return; }
      if (!groups.rejectJoin(gid, name)) { sendJSON(res, 404, { ok: false, error: '该申请不存在或已处理' }); return; }
      audit.add({ actor: me.username, action: 'group.request.reject', target: gid, detail: auditDetail('log.detail.group.reject', { name }), ip });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: '请求无效' });
    });
    return;
  }

  // POST /api/groups/members/remove —— 移除群成员 {gid, name}（群主/管理员；群主不可被移除）
  if (pathname === '/api/groups/members/remove' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const name = o && typeof o.name === 'string' ? o.name.trim() : '';
      const g = groups.getGroup(gid);
      if (!g) { sendJSON(res, 404, { ok: false, error: '群不存在' }); return; }
      const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
      if (!canManage) { sendJSON(res, 403, { ok: false, error: '无权限' }); return; }
      if (name === g.owner) { sendJSON(res, 400, { ok: false, error: '不能移除群主' }); return; }
      if (!groups.removeMember(gid, name)) { sendJSON(res, 404, { ok: false, error: '不是该群成员' }); return; }
      audit.add({ actor: me.username, action: 'group.member.remove', target: gid, detail: '移除成员：' + name, ip });
      broadcastGid(gid, { type: 'groups.changed', data: { gid } });
      // 被移出的人已不是成员，broadcastGid 覆盖不到他，必须单独通知
      notifyMembersChanged(gid, name, 'remove');
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: '请求无效' });
    });
    return;
  }

  // POST /api/groups/transfer —— 转移群主 {gid, name}（当前群主或管理员；受让者须在群内）
  if (pathname === '/api/groups/transfer' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const name = o && typeof o.name === 'string' ? o.name.trim() : '';
      const g = groups.getGroup(gid);
      if (!g) { sendJSON(res, 404, { ok: false, error: '群不存在' }); return; }
      const isOwner = groups.isOwner(gid, me.username);
      const isAdmin = auth.isAdmin(me.username);
      if (!isOwner && !isAdmin) { sendJSON(res, 403, { ok: false, error: '无权转移该群' }); return; }
      const oldOwner = isOwner ? me.username : g.owner;
      if (!groups.transferOwner(gid, oldOwner, name)) {
        sendJSON(res, 400, { ok: false, error: '受让人须为群成员且你须为当前群主' });
        return;
      }
      audit.add({ actor: me.username, action: 'group.transfer', target: gid, detail: '群主转给：' + name, ip });
      broadcast({ type: 'groups.changed' });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: '请求无效' });
    });
    return;
  }

  // POST /api/groups/file/delete —— 删除群内一条图片/文件 {gid, idx}（群主/管理员）
  if (pathname === '/api/groups/file/delete' && req.method === 'POST') {
    readBody(req, 4096).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const idx = o && o.idx != null ? Number(o.idx) : NaN;
      if (!groups.getGroup(gid)) { sendJSON(res, 404, { ok: false, error: '群不存在' }); return; }
      const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
      if (!canManage) { sendJSON(res, 403, { ok: false, error: '无权管理该群' }); return; }
      if (!store.removeGroupFile(idx, gid)) { sendJSON(res, 404, { ok: false, error: '该文件不存在或已删除' }); return; }
      audit.add({ actor: me.username, action: 'group.file.del', target: gid, detail: '删除群文件：#' + idx, ip });
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: '请求无效' });
    });
    return;
  }

  // GET /api/messages（可带 ?gid= 指定群房间 / ?dm= 指定私聊对方；缺省返回公共聊天）
  if (pathname === '/api/messages' && req.method === 'GET') {
    const gid = (urlObj.searchParams.get('gid') || '').trim() || null;
    const dmPeer = (urlObj.searchParams.get('dm') || '').trim() || null;
    if (dmPeer !== null) {
      if (dmPeer.length > 64 || dmPeer === me.username) {
        sendJSON(res, 403, { ok: false, error: 'api.dm.noView' });
        logger.write({ ip, method: req.method, url: pathname, status: 403, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const raw = auth.loadUsers() || {};
      if (!Object.prototype.hasOwnProperty.call(raw, dmPeer)) {
        sendJSON(res, 404, { ok: false, error: 'api.user.notFound' });
        logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      sendJSON(res, 200, { ok: true, messages: store.all(null, friends.pairKey(me.username, dmPeer)), max: store.MAX_MESSAGES });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    if (gid !== null) {
      if (gid.length > 64 || !groups.isMember(gid, me.username)) {
        sendJSON(res, 403, { ok: false, error: 'api.group.noViewMessages' });
        logger.write({ ip, method: req.method, url: pathname, status: 403, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
    }
    sendJSON(res, 200, { ok: true, messages: store.all(gid, null), max: store.MAX_MESSAGES });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/messages/search —— 搜索聊天记录
  //   ?gid= 或 ?dm= 限定在某个群 / 私聊（会话内搜索）；两个都不带就是「我的全部会话」
  //   ?q= 关键词；?limit= / ?offset= 分页。权限与 /api/messages 一致（不是成员就搜不到）
  if (pathname === '/api/messages/search' && req.method === 'GET') {
    const q = (urlObj.searchParams.get('q') || '').trim();
    const gid = (urlObj.searchParams.get('gid') || '').trim() || null;
    const dmPeer = (urlObj.searchParams.get('dm') || '').trim() || null;
    const limit = Math.min(Math.max(parseInt(urlObj.searchParams.get('limit') as string, 10) || 30, 1), 100);
    const offset = Math.max(parseInt(urlObj.searchParams.get('offset') as string, 10) || 0, 0);
    if (q.length > 64) {
      sendJSON(res, 400, { ok: false, error: 'api.badRequest' });
      logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    if (!q) {
      sendJSON(res, 200, { ok: true, hits: [], total: 0, q: '' });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    let scope: store.SearchScope;
    if (dmPeer !== null) {
      if (dmPeer.length > 64 || dmPeer === me.username) {
        sendJSON(res, 403, { ok: false, error: 'api.dm.noView' });
        logger.write({ ip, method: req.method, url: pathname, status: 403, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const raw = auth.loadUsers() || {};
      if (!Object.prototype.hasOwnProperty.call(raw, dmPeer)) {
        sendJSON(res, 404, { ok: false, error: 'api.user.notFound' });
        logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      scope = { kind: 'room', gid: null, dm: friends.pairKey(me.username, dmPeer) };
    } else if (gid !== null) {
      if (gid.length > 64 || !groups.isMember(gid, me.username)) {
        sendJSON(res, 403, { ok: false, error: 'api.group.noViewMessages' });
        logger.write({ ip, method: req.method, url: pathname, status: 403, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      scope = { kind: 'room', gid, dm: null };
    } else {
      scope = {
        kind: 'rooms',
        gids: groups.listGroupsOf(me.username).map((g: any) => String(g.id)),
        dms: store.dmRoomsOf(me.username)
      };
    }
    const found = store.searchMessages(q, scope, limit, offset);
    sendJSON(res, 200, { ok: true, hits: found.hits, total: found.total, q, scope: scope.kind });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/github/repo?repo=owner/name —— 消息里 GitHub 链接的仓库卡片（基础信息）
  // 前端一次请求拿全卡片要的数据；服务端内部带缓存 + 并发合并，见 server/lib/github.ts
  if (pathname === '/api/github/repo' && req.method === 'GET') {
    const full = (urlObj.searchParams.get('repo') || '').trim();
    if (!github.isValidFull(full)) {
      sendJSON(res, 400, { ok: false, error: 'api.badRequest' });
      logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    github.repoBasic(full).then((r) => {
      const body: Record<string, unknown> = { ok: !!r.data, repo: r.data, stale: r.stale, at: r.at };
      if (!r.data) body.error = githubErrorKey(r.error);
      sendJSON(res, 200, body);
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch(() => {
      sendJSON(res, 200, { ok: false, error: 'github.failed' });
    });
    return;
  }

  // GET /api/github/repo/detail?repo=owner/name —— 点开「展开详细信息」才取
  // （贡献者 / 语言构成 / 最新发布 / 提交历史；仓库主信息卡片里已经有了，不重复取）
  if (pathname === '/api/github/repo/detail' && req.method === 'GET') {
    const full = (urlObj.searchParams.get('repo') || '').trim();
    if (!github.isValidFull(full)) {
      sendJSON(res, 400, { ok: false, error: 'api.badRequest' });
      logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    github.repoDetail(full).then((r) => {
      const body: Record<string, unknown> = { ok: !!r.data, detail: r.data, stale: r.stale, at: r.at };
      if (!r.data) body.error = githubErrorKey(r.error);
      sendJSON(res, 200, body);
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch(() => {
      sendJSON(res, 200, { ok: false, error: 'github.failed' });
    });
    return;
  }

  // POST /api/upload —— 小文件单次上传（≤ CHUNK_SIZE）；大文件走下面的分片接口
  if (pathname === '/api/upload' && req.method === 'POST') {
    const ctype = req.headers['content-type'] || '';
    const bm = /boundary=([^;]+)/i.exec(ctype);
    if (!bm) { sendJSON(res, 400, { ok: false, error: 'api.upload.notMultipart' }); return; }
    // 声明体积就超限的直接拒绝：不必让客户端把上百 MB 传完才失败（"传到 99% 才报错"）。
    const declared = parseInt(req.headers['content-length'] as string, 10);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BODY) {
      sendJSON(res, 413, { ok: false, error: 'api.upload.tooLarge' });
      logger.write({ ip, method: req.method, url: pathname, status: 413, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      try { req.destroy(); } catch (e) { /* 忽略 */ }
      return;
    }
    streamUploadToDisk(req, bm[1].replace(/^"|"$/g, '')).then(async (file) => {
      const r = await finalizeUpload(file.head, file.name, file.size, file.sha,
        (dest) => renameOrCopy(file.tmpPath, dest));
      if (r.deduped) { try { fs.unlinkSync(file.tmpPath); } catch (e) { /* 忽略 */ } }
      audit.add({
        actor: me.username,
        action: 'upload',
        detail: r.deduped
          ? auditDetail('log.detail.upload.dedup', { name: r.name, size: r.size })
          : auditDetail(r.kind === 'image' ? 'log.detail.upload.image' : 'log.detail.upload.file',
            { name: r.name, size: r.size }),
        ip
      });
      sendJSON(res, 200, { ok: true, kind: r.kind, url: r.url, name: r.name, size: r.size, deduped: r.deduped });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      const msg = e && e.message;
      const status = msg === 'TOO_LARGE' ? 413 : 400;
      const error = msg === 'TOO_LARGE' ? 'api.upload.tooLarge' : (msg === 'NO_FILE' ? 'api.upload.noFile' : 'api.upload.failed');
      sendJSON(res, status, { ok: false, error });
      logger.write({ ip, method: req.method, url: pathname, status, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    });
    return;
  }

  // POST /api/upload/init —— 开启（或续传）分片会话 {name, size, uploadId?}
  // 续传：带上之前的 uploadId 且归属/体积一致时复用，返回已收到的分片序号，客户端只需补传缺失片。
  if (pathname === '/api/upload/init' && req.method === 'POST') {
    readBody(req, 4096).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const size = o && o.size != null ? Number(o.size) : NaN;
      if (!Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD) {
        sendJSON(res, 413, { ok: false, error: 'api.upload.tooLarge' });
        logger.write({ ip, method: req.method, url: pathname, status: 413, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const name = safeFileName(o && o.name);
      const chunks = Math.ceil(size / CHUNK_SIZE);

      const resumeId = o && typeof o.uploadId === 'string' ? o.uploadId : '';
      if (UPLOAD_ID_RE.test(resumeId)) {
        const meta = readSession(resumeId);
        if (meta && meta.owner === me.username && meta.size === size && meta.chunks === chunks) {
          sendJSON(res, 200, {
            ok: true, uploadId: resumeId, chunkSize: CHUNK_SIZE, chunks,
            received: receivedChunks(meta, sessionDir(resumeId))
          });
          logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
          return;
        }
      }
      const id = crypto.randomBytes(12).toString('hex');
      writeSession(id, { name, size, chunks, owner: me.username, ts: Date.now() });
      sendJSON(res, 200, { ok: true, uploadId: id, chunkSize: CHUNK_SIZE, chunks, received: [] });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.upload.failed' });
    });
    return;
  }

  // POST /api/upload/chunk?uploadId=&index= —— 上传单片（multipart，字段名 file）
  if (pathname === '/api/upload/chunk' && req.method === 'POST') {
    const uploadId = (urlObj.searchParams.get('uploadId') || '').trim();
    const index = parseInt(urlObj.searchParams.get('index') as string, 10);
    const ctype = req.headers['content-type'] || '';
    const bm = /boundary=([^;]+)/i.exec(ctype);
    if (!bm) { sendJSON(res, 400, { ok: false, error: 'api.upload.notMultipart' }); return; }
    // 会话必须存在且属于当前账号：否则让客户端重新 init（404 → sessionGone）
    const meta = UPLOAD_ID_RE.test(uploadId) ? readSession(uploadId) : null;
    if (!meta || meta.owner !== me.username) {
      sendJSON(res, 404, { ok: false, error: 'api.upload.sessionGone' });
      logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    if (!Number.isInteger(index) || index < 0 || index >= meta.chunks) {
      sendJSON(res, 400, { ok: false, error: 'api.upload.badChunk' });
      logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    const declared = parseInt(req.headers['content-length'] as string, 10);
    if (Number.isFinite(declared) && declared > CHUNK_BODY_LIMIT) {
      sendJSON(res, 413, { ok: false, error: 'api.upload.tooLarge' });
      logger.write({ ip, method: req.method, url: pathname, status: 413, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      try { req.destroy(); } catch (e) { /* 忽略 */ }
      return;
    }
    // 单片体积必须精确匹配（仅最后一片可短），否则拼接结果会损坏
    const expect = chunkSizeOf(meta, index);
    const dir = sessionDir(uploadId);
    // 客户端可带上本片 sha256：能挡住「长度正好不变」的传输损坏 / 内容错片
    // （不上报也接受，老客户端与不支持 crypto.subtle 的浏览器照常可用）
    const wantSha = (urlObj.searchParams.get('sha') || '').trim().toLowerCase();
    streamUploadToDisk(req, bm[1].replace(/^"|"$/g, ''), { maxBytes: expect, dir }).then((part) => {
      const bad = part.size !== expect || (CHUNK_SHA_RE.test(wantSha) && part.sha !== wantSha);
      if (bad) {
        try { fs.unlinkSync(part.tmpPath); } catch (e) { /* 忽略 */ }
        sendJSON(res, 400, { ok: false, error: 'api.upload.badChunk' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      // 先写临时名、校验通过再改名成 <index>.part：避免半截分片被后续 complete 当成已收
      renameOrCopy(part.tmpPath, partPath(dir, index));
      sendJSON(res, 200, { ok: true, index });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      const msg = e && e.message;
      const status = msg === 'TOO_LARGE' ? 413 : 400;
      sendJSON(res, status, { ok: false, error: msg === 'TOO_LARGE' ? 'api.upload.tooLarge' : 'api.upload.badChunk' });
      logger.write({ ip, method: req.method, url: pathname, status, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    });
    return;
  }

  // POST /api/upload/complete —— 合并分片并落盘 {uploadId}
  if (pathname === '/api/upload/complete' && req.method === 'POST') {
    readBody(req, 4096).then(async (body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const uploadId = o && typeof o.uploadId === 'string' ? o.uploadId : '';
      const meta = UPLOAD_ID_RE.test(uploadId) ? readSession(uploadId) : null;
      if (!meta || meta.owner !== me.username) {
        sendJSON(res, 404, { ok: false, error: 'api.upload.sessionGone' });
        logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const dir = sessionDir(uploadId);
      const got = receivedChunks(meta, dir);
      if (got.length !== meta.chunks) {
        // 还缺片：把已收到的序号回给客户端，便于继续补传
        sendJSON(res, 409, { ok: false, error: 'api.upload.incomplete', received: got });
        logger.write({ ip, method: req.method, url: pathname, status: 409, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      // 同一 uploadId 的合并串行化：重复/并发调用只会浪费一次读分片 + 写目标文件的开销，
      // 结果虽然被 sha 去重兜住了，但没必要让它们真的跑起来。
      if (mergingUploads.has(uploadId)) {
        sendJSON(res, 409, { ok: false, error: 'api.upload.merging' });
        logger.write({ ip, method: req.method, url: pathname, status: 409, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      mergingUploads.add(uploadId);
      try {
        const sha = await shaOfParts(meta, dir);
        const head = headOfFirstPart(dir);
        const r = await finalizeUpload(head, meta.name, meta.size, sha, (dest) => materialize(meta, dir, dest));
        removeSession(uploadId); // 已落盘（或命中去重），分片目录不再需要
        audit.add({
          actor: me.username,
          action: 'upload',
          detail: r.deduped
            ? auditDetail('log.detail.upload.dedup', { name: r.name, size: r.size })
            : auditDetail(r.kind === 'image' ? 'log.detail.upload.image' : 'log.detail.upload.file',
              { name: r.name, size: r.size }),
          ip
        });
        sendJSON(res, 200, { ok: true, kind: r.kind, url: r.url, name: r.name, size: r.size, deduped: r.deduped });
        logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      } finally {
        mergingUploads.delete(uploadId); // 无论成功失败都放锁，失败后可立即重试
      }
    }).catch((e) => {
      // 合并失败时**保留**会话与分片，客户端可直接重试 complete
      sendJSON(res, e && e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.upload.failed' });
      logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    });
    return;
  }

  // POST /api/upload/abort —— 放弃分片会话并清理已传分片 {uploadId}
  if (pathname === '/api/upload/abort' && req.method === 'POST') {
    readBody(req, 4096).then((body) => {
      let o: any = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const uploadId = o && typeof o.uploadId === 'string' ? o.uploadId : '';
      const meta = UPLOAD_ID_RE.test(uploadId) ? readSession(uploadId) : null;
      // 只允许放弃自己的会话；不存在也返回 ok（幂等）
      if (meta && meta.owner === me.username) removeSession(uploadId);
      sendJSON(res, 200, { ok: true });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.upload.failed' });
    });
    return;
  }

  // GET /api/health
  sendJSON(res, 404, { ok: false, error: 'api.notFound' });
  logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
}

// ---------- HTTP 入口 ----------

export function handleHttp(req: any, res: any): void {
  const ip = req.socket.remoteAddress || '-';
  let urlObj: any;
  try { urlObj = new URL(req.url, 'http://localhost'); } catch (e) {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  const pathname = urlObj.pathname;
  const t0 = Date.now();

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, urlObj, pathname, ip);
    return;
  }

  // 管理页仅管理员可访问：未登录跳登录页，已登录的非管理员跳回聊天页
  if (pathname === '/admin.html' || pathname === '/js/admin.js') {
    const u = auth.authByCookie(req.headers.cookie);
    if (!u || !auth.isAdmin(u.username)) {
      res.writeHead(302, { Location: u ? '/chat.html' : '/login.html' });
      res.end();
      logger.write({ ip, method: req.method, url: pathname, status: 302, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
  }

  // 登录页之外不做任何鉴权，静态资源直接服务
  serveStatic(req, res, pathname);
  logger.write({ ip, method: req.method, url: pathname, status: res.statusCode || 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
}

export function runFileCleanup(): void {
  try {
    const n = store.cleanupExpired(FILE_TTL_DAYS);
    if (n > 0) console.log('[cleanup] 文件过期清理：' + n + ' 个文件已删除，消息记录保留');
  } catch (e: any) {
    console.error('[cleanup] 文件过期清理失败：' + (e && e.message ? e.message : e));
  }
  purgeUploadTmp(); // 顺带收拾上传临时目录里的残留半成品
}

export { UPLOAD_DIR, FILE_CLEANUP_INTERVAL };
