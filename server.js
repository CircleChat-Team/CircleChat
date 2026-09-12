'use strict';
/* ============================================================
 * ChatPlus 私人聊天服务器  v1.0.0
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * [WM: 本文件为主服务，请勿改动，改动将导致完整性校验失败]
 *
 * 功能：两人私有聊天（文字 / 表情 / 图片 / 文件）
 * 技术：Node.js 原生 HTTP + 自研 WebSocket（零第三方依赖）
 * 安全：SHA256 加盐存储密码、会话 Cookie、登录限速、
 *       上传类型白名单 + 图片魔数校验、路径穿越防护
 * 数据：仅保留最近 500 条消息（data/messages.json）
 * 监控：所有 HTTP 请求与 WS 连接写入 data/access.log
 * 启动：node server.js   （默认端口 8080，可用 PORT 环境变量覆盖）
 * ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const auth = require('./lib/auth');
const store = require('./lib/store');
const wsproto = require('./lib/ws');
const logger = require('./lib/log');

// ---------- 配置 ----------
const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUB, 'uploads');
const MAX_UPLOAD = 20 * 1024 * 1024; // 上传上限 20MB
const MAX_TEXT_LEN = 4096;           // 单条文本长度上限

// 允许的图片扩展名
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
// 允许的文件扩展名（白名单）
const FILE_EXTS = new Set([
  '.txt', '.md', '.csv', '.json', '.log',
  '.pdf', '.zip', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.wav', '.flac'
]);

// ---------- 工具函数 ----------

const MIME = {
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
  '.mp4': 'video/mp4'
};

function sendJSON(res, status, obj) {
  // 连接可能已被客户端断开或请求体超限后销毁，此时写响应会抛错
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- 静态文件服务（含 gzip、路径穿越防护） ----------

function serveStatic(req, res, pathname) {
  let rel;
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
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    // JS/CSS/HTML 不缓存，保证更新后立即生效；图片类资源随机文件名，可长期缓存
    const cache = /\.(png|jpg|jpeg|gif|webp|ico|svg)$/.test(ext) ? 'public, max-age=86400' : 'no-cache';
    fs.readFile(filePath, (e2, data) => {
      if (e2) { res.writeHead(500); res.end(); return; }
      const acceptGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const big = data.length > 512 && /\.(html|css|js|json|svg|txt|md)$/.test(ext);
      const headers = {
        'Content-Type': type,
        'Cache-Control': cache,
        'X-Content-Type-Options': 'nosniff'
      };
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

// ---------- multipart 解析（自研，仅支持文件字段） ----------

function parseMultipart(buf, boundary) {
  const delim = Buffer.from('--' + boundary);
  const parts = [];
  let pos = 0;
  for (;;) {
    const start = buf.indexOf(delim, pos);
    if (start === -1) break;
    const headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerBuf = buf.slice(start + delim.length + 2, headerEnd); // 跳过行尾 \r\n
    const next = buf.indexOf(delim, headerEnd + 4);
    if (next === -1) break;
    const content = buf.slice(headerEnd + 4, next - 2); // 去掉尾部 \r\n
    parts.push({ header: headerBuf.toString('latin1'), content });
    pos = next + delim.length;
    // 判断是否结束标记 --boundary--
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // '--'
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;
  }
  return parts;
}

function partFilename(header) {
  const m = /filename="((?:[^"\\]|\\.)*)"/i.exec(header);
  if (!m) return null;
  // 浏览器以 UTF-8 原始字节发送，先 latin1 还原字节再转 UTF-8
  let name = Buffer.from(m[1], 'latin1').toString('utf8');
  name = path.basename(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return name.slice(0, 120) || null;
}

function partFieldName(header) {
  const m = /name="([^"]*)"/i.exec(header);
  return m ? m[1] : '';
}

// 图片魔数校验（防伪装文件）
function sniffImage(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// ---------- WebSocket 客户端管理 ----------

const clients = new Set(); // 所有在线 WS 连接

function clientId(c) {
  return c.user.username;
}

function broadcast(obj) {
  const data = wsproto.encodeText(JSON.stringify(obj));
  for (const c of clients) {
    try { c.socket.write(data); } catch (e) { /* 忽略 */ }
  }
}

function broadcastPresence() {
  const users = [...new Set([...clients].map(clientId))].sort();
  broadcast({ type: 'presence', users });
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

function handleWsUpgrade(req, socket, head) {
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

  const client = {
    socket,
    user,
    alive: true,
    close: () => { /* 见下 */
    }
  };

  const decoder = new wsproto.Decoder({
    onText: (text) => handleWsText(client, text),
    onPing: () => { client.alive = true; try { client.socket.write(wsproto.encodePing()); } catch (e) { /* 忽略 */ } },
    onClose: () => shutdownClient(client, 'close-frame')
  });

  client.close = () => shutdownClient(client, 'local');
  client.sendText = (s) => { try { client.socket.write(wsproto.encodeText(s)); } catch (e) { /* 忽略 */ } };

  socket.on('data', (chunk) => { client.alive = true; decoder.push(chunk); });
  socket.on('error', () => shutdownClient(client, 'error'));
  socket.on('close', () => shutdownClient(client, 'closed'));

  clients.add(client);
  broadcastPresence();
  logger.write({ ip, proto: 'ws', method: 'CONNECT', url: '/ws', status: 101, ua: req.headers['user-agent'] });
}

function shutdownClient(client, reason) {
  if (!clients.has(client)) return;
  clients.delete(client);
  try {
    // 先发送 Close 帧再 FIN，确保对端能收到
    client.socket.write(wsproto.encodeClose(1000));
    client.socket.end();
  } catch (e) { /* 忽略 */ }
  logger.write({ ip: client.user.ip, proto: 'ws', method: 'DISCONNECT', url: '/ws', status: 200 });
  broadcastPresence();
}

function handleWsText(client, text) {
  client.alive = true;
  let msg;
  try { msg = JSON.parse(text); } catch (e) { return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ping') {
    client.sendText(JSON.stringify({ type: 'pong', ts: Date.now() }));
    return;
  }
  if (msg.type === 'msg') {
    const d = msg.data || {};
    const type = d.type === 'image' || d.type === 'file' ? d.type : 'text';
    let content = String(d.content || '').slice(0, type === 'text' ? MAX_TEXT_LEN : 300);
    // 防注入：image/file 的 content 必须是本服务器上传目录的合法文件（防 javascript: 等伪造链接）
    if (type === 'text') {
      if (!content.trim()) return;
    } else {
      if (!/^\/uploads\/[a-zA-Z0-9]+\.[a-z0-9]{2,5}$/i.test(content)) return;
      if (d.name !== undefined && typeof d.name !== 'string') return;
      if (d.size !== undefined && (!Number.isInteger(d.size) || d.size < 0 || d.size > MAX_UPLOAD)) return;
    }
    const record = store.add({
      from: client.user.username,
      type,
      content,
      name: d.name,
      size: d.size
    });
    broadcast({ type: 'msg', data: record });
  }
  if (msg.type === 'recall') {
    const d = msg.data || {};
    const idx = Number(d.idx);
    if (!Number.isInteger(idx) || idx <= 0) return;
    const target = store.get(idx);
    if (!target) return;
    if (target.from !== client.user.username) return; // 只能撤回自己的消息
    store.recall(idx);
    broadcast({ type: 'recall', data: { idx, by: client.user.username } });
  }
}

// ---------- HTTP 路由 ----------

function handleApi(req, res, urlObj, pathname, ip) {
  const t0 = Date.now();

  // POST /api/login
  if (pathname === '/api/login' && req.method === 'POST') {
    if (auth.isLocked(ip)) {
      sendJSON(res, 429, { ok: false, error: '尝试次数过多，请 10 分钟后再试' });
      logger.write({ ip, method: req.method, url: pathname, status: 429, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }
    readBody(req, 8192).then((body) => {
      let u, p;
      try { ({ username: u, password: p } = JSON.parse(body.toString('utf8'))); } catch (e) { /* 解析失败走下面校验 */ }
      if (typeof u !== 'string' || typeof p !== 'string') {
        auth.recordFail(ip);
        sendJSON(res, 400, { ok: false, error: '参数错误' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const user = auth.login(u.trim(), p);
      if (!user) {
        auth.recordFail(ip);
        sendJSON(res, 401, { ok: false, error: '账号或密码错误' });
        logger.write({ ip, method: req.method, url: pathname, status: 401, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const token = auth.createSession(user.username, ip);
      auth.clearFails(ip);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': 'chatplus_token=' + encodeURIComponent(token) +
          '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (7 * 24 * 3600)
      });
      res.end(JSON.stringify({ ok: true, username: user.username }));
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: '请求无效' });
    });
    return;
  }

  // POST /api/logout
  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = auth.tokenFromCookie(req.headers.cookie);
    if (token) auth.destroySession(token);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'chatplus_token=; Path=/; HttpOnly; Max-Age=0'
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

  // 以下接口均需登录
  const me = auth.authByCookie(req.headers.cookie);
  if (!me) {
    sendJSON(res, 401, { ok: false, error: '未登录' });
    logger.write({ ip, method: req.method, url: pathname, status: 401, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/me
  if (pathname === '/api/me' && req.method === 'GET') {
    const online = [...clients].map(clientId);
    sendJSON(res, 200, { ok: true, username: me.username, online });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/users（全部账号名 + 头像配置，用于在线状态展示）
  if (pathname === '/api/users' && req.method === 'GET') {
    const raw = auth.loadUsers() || {};
    const users = Object.keys(raw).sort().map((name) => ({ name, image: raw[name].image || null }));
    sendJSON(res, 200, { ok: true, users });
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
      let patch;
      try { patch = JSON.parse(body.toString('utf8')); } catch (e) { patch = null; }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        sendJSON(res, 400, { ok: false, error: '参数错误' });
        return;
      }
      if (patch.notify !== undefined && typeof patch.notify !== 'boolean') {
        sendJSON(res, 400, { ok: false, error: '参数错误' });
        return;
      }
      auth.setSettings(me.username, patch);
      sendJSON(res, 200, { ok: true, settings: auth.getSettings(me.username) });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: '请求无效' });
    });
    return;
  }

  // GET /api/messages
  if (pathname === '/api/messages' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, messages: store.all(), max: store.MAX_MESSAGES });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/upload
  if (pathname === '/api/upload' && req.method === 'POST') {
    const ctype = req.headers['content-type'] || '';
    const bm = /boundary=([^;]+)/i.exec(ctype);
    if (!bm) { sendJSON(res, 400, { ok: false, error: '不是 multipart 请求' }); return; }
    readBody(req, MAX_UPLOAD + 4096).then((body) => {
      const parts = parseMultipart(body, bm[1].replace(/^"|"$/g, ''));
      const filePart = parts.find((pt) => partFieldName(pt.header) === 'file');
      if (!filePart || !filePart.content.length) {
        sendJSON(res, 400, { ok: false, error: '缺少文件' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const buf = filePart.content;
      const origName = partFilename(filePart.header) || 'file';
      const ext = path.extname(origName).toLowerCase();

      // 类型判定：图片需扩展名白名单 + 魔数校验；其他按文件扩展名白名单
      const sniffed = sniffImage(buf);
      let kind = null;
      if (IMAGE_EXTS.has(ext) && sniffed) kind = 'image';
      else if (FILE_EXTS.has(ext)) kind = 'file';
      if (!kind) {
        sendJSON(res, 400, { ok: false, error: '不支持的文件类型' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const saveName = crypto.randomBytes(8).toString('hex') + ext;
      const savePath = path.join(UPLOAD_DIR, saveName);
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(savePath, buf);
      sendJSON(res, 200, {
        ok: true,
        kind,
        url: '/uploads/' + saveName,
        name: origName,
        size: buf.length
      });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: e.message === 'BODY_TOO_LARGE' ? '文件过大（上限 20MB）' : '上传失败' });
    });
    return;
  }

  // GET /api/health
  sendJSON(res, 404, { ok: false, error: '接口不存在' });
  logger.write({ ip, method: req.method, url: pathname, status: 404, ms: Date.now() - t0, ua: req.headers['user-agent'] });
}

// ---------- HTTP 服务器 ----------

function handleHttp(req, res) {
  const ip = req.socket.remoteAddress || '-';
  let urlObj;
  try { urlObj = new URL(req.url, 'http://localhost'); } catch (e) {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  const pathname = urlObj.pathname;
  const t0 = Date.now();

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, urlObj, pathname, ip);
    return;
  }
  // 登录页之外不做任何鉴权，静态资源直接服务
  serveStatic(req, res, pathname);
  logger.write({ ip, method: req.method, url: pathname, status: res.statusCode || 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
}

const server = http.createServer(handleHttp);
server.on('upgrade', handleWsUpgrade);

// ---------- 启动 ----------

auth.init(false);
store.load();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

server.listen(PORT, HOST, () => {
  console.log('==========================================');
  console.log(' ChatPlus 私人聊天服务器 v1.0.0 已启动');
  console.log(' 版权 © 2026 Ctoy，保留所有权利');
  console.log(' 监听地址: http://' + HOST + ':' + PORT);
  console.log(' 数据目录: ' + path.join(ROOT, 'data'));
  console.log(' 消息保留: 最近 ' + store.MAX_MESSAGES + ' 条');
  console.log(' 上传上限: ' + (MAX_UPLOAD / 1024 / 1024) + ' MB');
  console.log('==========================================');
});

process.on('SIGINT', () => { console.log('\n收到退出信号，正在退出…'); process.exit(0); });
process.on('SIGTERM', () => process.exit(0));
