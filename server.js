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
const groups = require('./lib/groups');
const friends = require('./lib/friends');
const audit = require('./lib/audit');
const wsproto = require('./lib/ws');
const logger = require('./lib/log');
const migrate = require('./lib/migrate');

// 审计详情结构化：以 {k: i18n 键, v: 占位变量} 形式写入 detail 字段，
// 前端按当前语言翻译；旧版直接写死的中文详情作为兜底原样显示
function auditDetail(key, vars) {
  return JSON.stringify({ k: key, v: vars || {} });
}

// ---------- 配置 ----------
const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUB, 'uploads');
const MAX_UPLOAD = 20 * 1024 * 1024; // 上传上限 20MB
const MAX_TEXT_LEN = 4096;           // 单条文本长度上限

// 上传文件保留天数：超期后删除硬盘文件，消息记录保留并显示「图片/文件已过期」
// 可用环境变量 FILE_TTL_DAYS 覆盖，默认 15 天
const FILE_TTL_DAYS = Math.max(1, parseInt(process.env.FILE_TTL_DAYS, 10) || 15);
const FILE_CLEANUP_INTERVAL = 6 * 3600 * 1000; // 每 6 小时检查一次

// 管理员新建用户时的用户名规则：2-20 位字母/数字/下划线/中文/点/横线
const USERNAME_RE = /^[\w\u4e00-\u9fa5\-.]{2,20}$/;
const MIN_PASS_LEN = 6;
const MAX_PASS_LEN = 64;

// 图片扩展名（仅用于「扩展名伪装成图片但内容不是图片」时降级处理）
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

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
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4'
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
    let type = MIME[ext] || 'application/octet-stream';
    // 上传目录防存储型 XSS：除图片外一律作为附件下载，
    // 避免 .html / .svg / .xml 等被浏览器以本站同源页面身份渲染并执行脚本。
    let attachment = false;
    if (filePath.startsWith(UPLOAD_DIR + path.sep) && !/^image\/(png|jpeg|gif|webp)$/.test(type)) {
      type = 'application/octet-stream';
      attachment = true;
    }
    // JS/CSS/HTML 不缓存，保证更新后立即生效；图片类资源随机文件名，可长期缓存；
    // vendor 是体积较大的第三方静态资源（很少变动），缓存 7 天，升级时改页面上的 ?v= 即可
    const isVendor = filePath.startsWith(path.join(PUB, 'vendor') + path.sep);
    const cache = isVendor
      ? 'public, max-age=604800'
      : (/\.(png|jpg|jpeg|gif|webp|ico|svg)$/.test(ext) ? 'public, max-age=86400' : 'no-cache');
    fs.readFile(filePath, (e2, data) => {
      if (e2) { res.writeHead(500); res.end(); return; }
      const acceptGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const big = !attachment && data.length > 512 && /\.(html|css|js|json|svg|txt|md)$/.test(ext);
      const headers = {
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
const typingLast = new Map(); // 用户名 -> 上次转发「正在输入」的时间（节流用）

function clientId(c) {
  return c.user.username;
}

function broadcast(obj) {
  const data = wsproto.encodeText(JSON.stringify(obj));
  for (const c of clients) {
    try { c.socket.write(data); } catch (e) { /* 忽略 */ }
  }
}

function sendTo(client, obj) {
  try { client.sendText(JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
}

// 推送给某群的在线成员
function broadcastGid(gid, obj) {
  for (const c of clients) {
    if (groups.isMember(gid, c.user.username)) sendTo(c, obj);
  }
}

// 推送给私聊房间（dm 为规范化 key `小:大`）的在线双方
function broadcastDm(dm, obj) {
  const pair = String(dm).split(':');
  for (const c of clients) {
    if (pair.indexOf(c.user.username) !== -1) sendTo(c, obj);
  }
}

// 按房间推送：dm 非空为私聊（仅双方）；gid=null 为公共聊天（全量）；否则按群推成员
function broadcastRoom(gid, dm, obj) {
  if (dm != null) broadcastDm(dm, obj);
  else if (gid == null) broadcast(obj);
  else broadcastGid(gid, obj);
}

/** 文本中是否 @提及了指定用户名（边界匹配，避免 @apple 误伤 @a） */
function mentionsUser(text, name) {
  if (!text || !name) return false;
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^\\w\\u4e00-\\u9fa5\\-.])@' + esc + '($|[\\s,，。；;！!？?.]|@)', 'u').test(String(text));
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
  // 对端直接断开（关标签页 / 断网）时只会触发 end，必须在这里清理，
  // 否则该用户会一直显示在线，直到下一次心跳超时。
  socket.on('end', () => shutdownClient(client, 'end'));
  socket.on('error', () => shutdownClient(client, 'error'));
  socket.on('close', () => shutdownClient(client, 'closed'));

  clients.add(client);
  broadcastPresence();
  logger.write({ ip, proto: 'ws', method: 'CONNECT', url: '/ws', status: 101, ua: req.headers['user-agent'] });
}

function shutdownClient(client, reason) {
  if (!clients.has(client)) return;
  clients.delete(client);
  typingLast.delete(client.user.username);
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
  if (msg.type === 'typing') {
    // 正在输入：服务端再节流一次（同一用户 2 秒内只转发一次），且不回显给发起者
    const u = client.user.username;
    const now = Date.now();
    if (now - (typingLast.get(u) || 0) > 2000) {
      typingLast.set(u, now);
      const frame = wsproto.encodeText(JSON.stringify({ type: 'typing', from: u }));
      // 私聊：只推给对方；公共 / 群聊：推给其余所有在线
      const pm = msg.data && msg.data.pm != null ? String(msg.data.pm).trim() : null;
      for (const c of clients) {
        if (c === client) continue;
        if (pm) { if (c.user.username !== pm) continue; }
        try { c.socket.write(frame); } catch (e) { /* 忽略 */ }
      }
    }
    return;
  }
  if (msg.type === 'msg') {
    const d = msg.data || {};
    const type = d.type === 'image' || d.type === 'file' ? d.type : 'text';
    let content = String(d.content || '').slice(0, type === 'text' ? MAX_TEXT_LEN : 300);
    const from = client.user.username;
    // 目标房间：dm 为私聊（对方用户名），否则 gid 为群 / 公共
    let dm = null;
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
      // 好友门禁：非好友私聊仅可发文字 / 图片
      if (!friends.isFriend(from, dm.split(':').find((u) => u !== from))) {
        if (type === 'file') return; // 禁发文件
        if (d.replyTo !== undefined && d.replyTo !== null) return; // 禁引用
        if (type === 'text' && mentionsUser(content, dm.split(':').find((u) => u !== from))) return; // 禁 @提及
      }
    }
    // 防注入：image/file 的 content 必须是本服务器上传目录的合法文件（防 javascript: 等伪造链接）
    if (type === 'text') {
      if (!content.trim()) return;
    } else {
      if (!/^\/uploads\/[a-zA-Z0-9]+\.[a-z0-9]{1,8}$/i.test(content)) return;
      if (d.name !== undefined && typeof d.name !== 'string') return;
      if (d.size !== undefined && (!Number.isInteger(d.size) || d.size < 0 || d.size > MAX_UPLOAD)) return;
    }
    // 引用回复：只接受存在且未被撤回的消息；私聊里仅本房间的消息可被引用
    let replyTo = null;
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
      dm
    });
    audit.add({
      actor: from,
      action: dm != null ? 'dm.msg' : (gid == null ? 'msg' : 'group.msg'),
      target: dm != null ? record.idx : (gid == null ? record.idx : gid),
      detail: auditDetail(type === 'text'
        ? 'log.detail.msg.text' : (type === 'image' ? 'log.detail.msg.image' : 'log.detail.msg.file'),
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
    broadcastRoom(target.gid, target.dm, {
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
    broadcastRoom(room, target.dm, {
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

// ---------- HTTP 路由 ----------

function handleApi(req, res, urlObj, pathname, ip) {
  const t0 = Date.now();

  // POST /api/register —— 提交注册申请（开放注册，需管理员审核通过后才可登录）
  if (pathname === '/api/register' && req.method === 'POST') {
    readBody(req, 8192).then((body) => {
      let o = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const name = o && typeof o.name === 'string' ? o.name.trim() : '';
      const pass = o && typeof o.password === 'string' ? o.password : '';
      if (!USERNAME_RE.test(name) || pass.length < MIN_PASS_LEN || pass.length > MAX_PASS_LEN) {
        sendJSON(res, 400, { ok: false, error: 'api.user.registerFormat' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      if (!auth.submitRegistration(name, pass)) {
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
      let u, p;
      try { ({ username: u, password: p } = JSON.parse(body.toString('utf8'))); } catch (e) { /* 解析失败走下面校验 */ }
      if (typeof u !== 'string' || typeof p !== 'string') {
        auth.recordFail(ip);
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
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
      const token = auth.createSession(user.username, ip);
      auth.clearFails(ip);
      audit.add({ actor: user.username, action: 'login', detail: auditDetail('log.detail.login.ok'), ip });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': 'chatplus_token=' + encodeURIComponent(token) +
          '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (7 * 24 * 3600)
      });
      res.end(JSON.stringify({ ok: true, username: user.username }));
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'api.badRequest' });
    });
    return;
  }

  // POST /api/logout
  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = auth.tokenFromCookie(req.headers.cookie);
    const sess = auth.getSession(token);
    if (sess) audit.add({ actor: sess.username, action: 'logout', detail: auditDetail('log.detail.logout'), ip });
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
    sendJSON(res, 401, { ok: false, error: 'api.unauthorized' });
    logger.write({ ip, method: req.method, url: pathname, status: 401, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/me
  if (pathname === '/api/me' && req.method === 'GET') {
    const online = [...clients].map(clientId);
    sendJSON(res, 200, { ok: true, username: me.username, role: auth.getRole(me.username), online });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // GET /api/users（全部账号名 + 头像配置，用于在线状态展示）
  if (pathname === '/api/users' && req.method === 'GET') {
    const q = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
    const raw = auth.loadUsers() || {};
    const users = Object.keys(raw)
      .filter((name) => name !== me.username && (q === '' || String(name).toLowerCase().indexOf(q) !== -1))
      .sort()
      .map((name) => ({ name, image: raw[name].image || null }));
    sendJSON(res, 200, { ok: true, users });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // ---------- 好友接口 ----------

  // 带在线/头像装饰的用户名列表
  function decorateNames(names) {
    const raw = auth.loadUsers() || {};
    const online = new Set([...clients].map(clientId));
    return names.map(function (n) {
      const o = { name: n, online: online.has(n) };
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
      let o = null;
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
      let o = null;
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
      let o = null;
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
    const online = new Set([...clients].map(clientId));
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
      let patch;
      try { patch = JSON.parse(body.toString('utf8')); } catch (e) { patch = null; }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        sendJSON(res, 400, { ok: false, error: 'api.invalidParams' });
        return;
      }
      if (patch.notify !== undefined && typeof patch.notify !== 'boolean') {
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

  // ---------- 管理员接口（仅 role=admin 可用） ----------

  if (pathname.indexOf('/api/admin/') === 0) {
    if (!auth.isAdmin(me.username)) {
      sendJSON(res, 403, { ok: false, error: 'api.admin.forbidden' });
      logger.write({ ip, method: req.method, url: pathname, status: 403, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }

    // GET /api/admin/users —— 用户列表（含角色与在线状态）
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const raw = auth.loadUsers() || {};
      const online = new Set([...clients].map(clientId));
      const users = Object.keys(raw).sort().map((name) => ({
        name,
        role: raw[name].role === 'admin' ? 'admin' : 'user',
        status: raw[name].status || auth.STATUS.ACTIVE,
        created: raw[name].created || null,
        image: raw[name].image || null,
        online: online.has(name)
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
        let o = null;
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
        let o = null;
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
    if (pathname === '/api/admin/logs' && req.method === 'GET') {
      const q = urlObj.searchParams;
      const page = audit.list({
        limit: q.get('limit'),
        offset: q.get('offset'),
        actor: (q.get('actor') || '').trim() || undefined,
        action: (q.get('action') || '').trim() || undefined
      });
      sendJSON(res, 200, { ok: true, total: page.total, logs: page.logs, max: audit.MAX_LOGS });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
      return;
    }

    // POST /api/admin/user/add —— 新建用户 {name, password, role?}
    if (pathname === '/api/admin/user/add' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        const pass = o && typeof o.password === 'string' ? o.password : '';
        if (!USERNAME_RE.test(name) || pass.length < MIN_PASS_LEN || pass.length > MAX_PASS_LEN) {
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
        let o = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        if (!name) { sendJSON(res, 400, { ok: false, error: 'api.invalidParams' }); return; }
        if (name === me.username) { sendJSON(res, 400, { ok: false, error: 'api.admin.cannotDeleteSelf' }); return; }
        if (name === 'admin') { sendJSON(res, 400, { ok: false, error: 'api.admin.cannotDeleteAdmin' }); return; }
        if (!auth.deleteUser(name)) { sendJSON(res, 404, { ok: false, error: 'api.user.notFound' }); return; }
        groups.removeUserAll(name); // 清理该用户在各群的全部成员关系，避免遗留孤儿
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

    // POST /api/admin/user/pass —— 重置密码 {name, password}
    if (pathname === '/api/admin/user/pass' && req.method === 'POST') {
      readBody(req, 2048).then((body) => {
        let o = null;
        try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
        const name = o && typeof o.name === 'string' ? o.name.trim() : '';
        const pass = o && typeof o.password === 'string' ? o.password : '';
        if (!name || pass.length < MIN_PASS_LEN || pass.length > MAX_PASS_LEN) {
          sendJSON(res, 400, { ok: false, error: 'api.user.passwordTooShort' });
          return;
        }
        if (!auth.setPassword(name, pass)) {
          sendJSON(res, 404, { ok: false, error: 'api.user.notFound' });
          return;
        }
        audit.add({ actor: me.username, action: 'admin.user.pass', target: name, detail: auditDetail('log.detail.user.pass', { name }), ip });
        sendJSON(res, 200, { ok: true });
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

  // /api/groups/:action 辅助：按路径段分派 join / leave / rename
  // GET /api/groups —— 我的群列表
  if (pathname === '/api/groups' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, groups: groups.listGroupsOf(me.username) });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/groups —— 创建群 {name}
  if (pathname === '/api/groups' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o = null;
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
      let o = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      const g = groups.getGroup(gid);
      if (!g) { sendJSON(res, 404, { ok: false, error: 'api.group.notFound' }); return; }
      const canManage = groups.isOwner(gid, me.username) || auth.isAdmin(me.username);
      if (!canManage) { sendJSON(res, 403, { ok: false, error: 'api.group.noDismiss' }); return; }
      store.dissolveMessages(gid);
      groups.dissolveGroup(gid);
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
    sendJSON(res, 200, { ok: true, gid, members: groups.groupMembers(gid) });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/groups/join —— 加入群 {gid}
  if (pathname === '/api/groups/join' && req.method === 'POST') {
    readBody(req, 2048).then((body) => {
      let o = null;
      try { o = JSON.parse(body.toString('utf8')); } catch (e) { /* 校验统一走下面 */ }
      const gid = o && typeof o.gid === 'string' ? o.gid.trim() : '';
      if (gid.length > 64 || !groups.getGroup(gid)) {
        sendJSON(res, 404, { ok: false, error: 'api.group.notFound' });
        return;
      }
      groups.addMember(gid, me.username);
      audit.add({ actor: me.username, action: 'group.join', target: gid, detail: auditDetail('log.detail.group.join'), ip });
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
      let o = null;
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
      let o = null;
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
    sendJSON(res, 200, { ok: true, messages: store.all(gid), max: store.MAX_MESSAGES });
    logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    return;
  }

  // POST /api/upload
  if (pathname === '/api/upload' && req.method === 'POST') {
    const ctype = req.headers['content-type'] || '';
    const bm = /boundary=([^;]+)/i.exec(ctype);
    if (!bm) { sendJSON(res, 400, { ok: false, error: 'api.upload.notMultipart' }); return; }
    readBody(req, MAX_UPLOAD + 4096).then((body) => {
      const parts = parseMultipart(body, bm[1].replace(/^"|"$/g, ''));
      const filePart = parts.find((pt) => partFieldName(pt.header) === 'file');
      if (!filePart || !filePart.content.length) {
        sendJSON(res, 400, { ok: false, error: 'api.upload.noFile' });
        logger.write({ ip, method: req.method, url: pathname, status: 400, ms: Date.now() - t0, ua: req.headers['user-agent'] });
        return;
      }
      const buf = filePart.content;
      const origName = partFilename(filePart.header) || 'file';
      const ext = path.extname(origName).toLowerCase();

      // 不限文件类型，一律接收。
      // 是否为图片只按文件内容（魔数）判断，与文件名无关。
      const sniffed = sniffImage(buf);
      const kind = sniffed ? 'image' : 'file';

      // 落盘扩展名：
      //   图片 -> 用嗅探出的真实格式，保证能被正确内联显示（改名成 .png 的假图片也会被识破）；
      //   其它 -> 保留原扩展名（仅保留安全字符），扩展名伪装成图片但内容不是则降级为 .bin。
      let saveExt;
      if (sniffed) {
        saveExt = '.' + sniffed;
      } else {
        const safeExt = /^\.[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : '.bin';
        saveExt = IMAGE_EXTS.has(safeExt) ? '.bin' : safeExt;
      }
      const saveName = crypto.randomBytes(8).toString('hex') + saveExt;
      const savePath = path.join(UPLOAD_DIR, saveName);
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(savePath, buf);
      audit.add({
        actor: me.username,
        action: 'upload',
        detail: auditDetail(kind === 'image' ? 'log.detail.upload.image' : 'log.detail.upload.file',
          { name: origName, size: buf.length }),
        ip
      });
      sendJSON(res, 200, {
        ok: true,
        kind,
        url: '/uploads/' + saveName,
        name: origName,
        size: buf.length
      });
      logger.write({ ip, method: req.method, url: pathname, status: 200, ms: Date.now() - t0, ua: req.headers['user-agent'] });
    }).catch((e) => {
      sendJSON(res, e.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: e.message === 'BODY_TOO_LARGE' ? 'api.upload.tooLarge' : 'api.upload.failed' });
    });
    return;
  }

  // GET /api/health
  sendJSON(res, 404, { ok: false, error: 'api.notFound' });
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

const server = http.createServer(handleHttp);
server.on('upgrade', handleWsUpgrade);

// ---------- 启动 ----------

migrate.run();            // 启动前校验并自动迁移数据库结构（兼容旧库）
auth.init(false);
store.load();
audit.load();             // 初始化审计日志表
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 过期文件清理：启动时执行一次，之后定期检查。
// 只删除硬盘文件，消息记录保留（前端显示「图片/文件已过期」，文件仍显示文件名）。
function runFileCleanup() {
  try {
    const n = store.cleanupExpired(FILE_TTL_DAYS);
    if (n > 0) console.log('[cleanup] 文件过期清理：' + n + ' 个文件已删除，消息记录保留');
  } catch (e) {
    console.error('[cleanup] 文件过期清理失败：' + (e && e.message ? e.message : e));
  }
}
runFileCleanup();
setInterval(runFileCleanup, FILE_CLEANUP_INTERVAL).unref();

server.listen(PORT, HOST, () => {
  console.log('==========================================');
  console.log(' ChatPlus 私人聊天服务器 v1.0.0 已启动');
  console.log(' 版权 © 2026 Ctoy，保留所有权利');
  console.log(' 监听地址: http://' + HOST + ':' + PORT);
  console.log(' 数据目录: ' + path.join(ROOT, 'data'));
  console.log(' 消息保留: 最近 ' + store.MAX_MESSAGES + ' 条');
  console.log(' 上传上限: ' + (MAX_UPLOAD / 1024 / 1024) + ' MB');
  console.log(' 文件保留: ' + FILE_TTL_DAYS + ' 天（超期仅删文件，消息保留）');
  console.log('==========================================');
});

process.on('SIGINT', () => { console.log('\n收到退出信号，正在退出…'); process.exit(0); });
process.on('SIGTERM', () => process.exit(0));
