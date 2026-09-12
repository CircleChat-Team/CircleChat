'use strict';
/* ============================================================
 * ChatPlus 私人聊天服务器 — 认证模块（SHA256 + 盐）
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * [WM: 本模块为关键安全模块，请勿改动，改动将导致完整性校验失败]
 * 密码不以明文存储：sha256(盐 + 密码)，存储格式为 盐$哈希。
 * ============================================================ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const SESSION_TTL = 7 * 24 * 3600 * 1000; // 会话有效期 7 天

// ---------- 密码哈希 ----------

/** SHA256 摘要（hex） */
function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** 生成带盐的密码哈希：盐$SHA256(盐+密码) */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + '$' + sha256(salt + password);
}

/** 校验密码 */
function verifyPassword(password, stored) {
  const idx = stored.indexOf('$');
  if (idx <= 0) return false;
  const salt = stored.slice(0, idx);
  const hash = stored.slice(idx + 1);
  return sha256(salt + password) === hash;
}

// ---------- 用户存储 ----------

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

/**
 * 初始化用户数据。
 * 首次启动时，若 users.json 不存在，则用内置默认账号创建。
 * 内置默认账号（仅用于首次初始化，部署后请及时修改密码）：
 *   Ctoy       / Yhc061900
 *   system_mini / SYSTEM_mini1234
 */
function init(forceDefaults) {
  let users = loadUsers();
  if (users && typeof users === 'object' && !forceDefaults) return users;
  users = {};
  const defaults = {
    'Ctoy': 'Yhc061900',
    'system_mini': 'SYSTEM_mini1234'
  };
  for (const name of Object.keys(defaults)) {
    users[name] = {
      pass: hashPassword(defaults[name]),
      created: Date.now(),
      role: 'user'
    };
  }
  saveUsers(users);
  return users;
}

/** 校验登录，成功返回 {username}，失败返回 null */
function login(username, password) {
  const users = loadUsers() || {};
  const rec = users[username];
  if (!rec || !verifyPassword(password, rec.pass)) return null;
  return { username };
}

/** 修改密码（管理员或本人） */
function setPassword(username, newPassword) {
  const users = loadUsers() || {};
  if (!users[username]) return false;
  users[username].pass = hashPassword(newPassword);
  users[username].updated = Date.now();
  saveUsers(users);
  return true;
}

/** 读取用户设置 */
function getSettings(username) {
  const users = loadUsers() || {};
  const rec = users[username];
  return (rec && rec.settings) || {};
}

/** 合并保存用户设置（白名单字段由接口层校验） */
function setSettings(username, patch) {
  const users = loadUsers() || {};
  const rec = users[username];
  if (!rec) return false;
  rec.settings = Object.assign({}, rec.settings || {}, patch);
  rec.updated = Date.now();
  saveUsers(users);
  return true;
}

// ---------- 会话管理（内存存储） ----------

const sessions = new Map(); // token -> {username, ip, expires}

function createSession(username, ip) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, ip, expires: Date.now() + SESSION_TTL });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

/** 从 Cookie 头中解析 token */
function tokenFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)chatplus_token=([^;\s]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** 从 Cookie 头中获取当前用户 */
function authByCookie(cookieHeader) {
  const token = tokenFromCookie(cookieHeader);
  const s = getSession(token);
  return s ? { username: s.username, ip: s.ip, token } : null;
}

// ---------- 登录限速（防暴力破解） ----------

const failMap = new Map(); // ip -> {count, until}
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000; // 锁定 10 分钟

function isLocked(ip) {
  const rec = failMap.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.until) { failMap.delete(ip); return false; }
  return true;
}

function recordFail(ip) {
  const rec = failMap.get(ip) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= MAX_FAILS) rec.until = Date.now() + LOCK_MS;
  failMap.set(ip, rec);
}

function clearFails(ip) {
  failMap.delete(ip);
}

module.exports = {
  sha256,
  hashPassword,
  verifyPassword,
  init,
  loadUsers,
  setPassword,
  login,
  createSession,
  getSession,
  destroySession,
  tokenFromCookie,
  authByCookie,
  isLocked,
  recordFail,
  clearFails,
  getSettings,
  setSettings,
  USERS_FILE
};
