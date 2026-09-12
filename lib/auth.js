'use strict';
/* ============================================================
 * ChatPlus 私人聊天服务器 — 认证模块（SHA256 + 盐）
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * [WM: 本模块为关键安全模块，请勿改动，改动将导致完整性校验失败]
 * 密码不以明文存储：sha256(盐 + 密码)，存储格式为 盐$哈希。
 * 用户数据持久化到 data/chatplus.db（SQLite，使用 Node 内置 node:sqlite）。
 * ============================================================ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'chatplus.db');

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

// ---------- 数据库 ----------

let db = null;

function open() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      name    TEXT PRIMARY KEY,
      pass    TEXT NOT NULL,
      created INTEGER,
      role    TEXT,
      image   TEXT,
      settings TEXT,
      updated INTEGER
    );
  `);
  return db;
}

function rowToUser(r) {
  if (!r) return null;
  const u = { pass: r.pass };
  if (r.created != null) u.created = r.created;
  if (r.role != null) u.role = r.role;
  if (r.image != null) u.image = r.image;
  try { u.settings = r.settings ? JSON.parse(r.settings) : {}; } catch (e) { u.settings = {}; }
  if (r.updated != null) u.updated = r.updated;
  return u;
}

/** 从已有 users.json 迁移（仅首次、表为空时） */
function migrateFromJson() {
  const d = open();
  if (d.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return;
  const jsonPath = path.join(DATA_DIR, 'users.json');
  if (!fs.existsSync(jsonPath)) return;
  let obj;
  try { obj = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { return; }
  if (!obj || typeof obj !== 'object') return;
  const names = Object.keys(obj);
  if (!names.length) return;
  const ins = d.prepare('INSERT INTO users (name, pass, created, role, image, settings, updated) VALUES (?, ?, ?, ?, ?, ?, ?)');
  d.prepare('BEGIN').run();
  try {
    for (const name of names) {
      const r = obj[name] || {};
      ins.run(name, String(r.pass || ''),
        r.created != null ? Number(r.created) : null,
        r.role != null ? String(r.role) : null,
        r.image != null ? String(r.image) : null,
        r.settings != null ? JSON.stringify(r.settings) : null,
        r.updated != null ? Number(r.updated) : null);
    }
    d.prepare('COMMIT').run();
  } catch (e) {
    d.prepare('ROLLBACK').run();
    throw e;
  }
}

// ---------- 用户存储 ----------

/** 返回 { name: {pass, created, role, image, settings, updated} } 供接口层使用 */
function loadUsers() {
  const rows = open().prepare('SELECT name, pass, created, role, image, settings, updated FROM users').all();
  const map = {};
  for (const r of rows) map[r.name] = rowToUser(r);
  return map;
}

// ---------- 内置账号 ----------

/** 内置管理员账号（role=admin：可管理用户、可撤回任意人的消息） */
const BUILTIN_ADMIN = { name: 'admin', pass: 'Admin1234', role: 'admin' };

/** 首次初始化时创建的普通账号（部署后请及时修改密码） */
const DEFAULT_USERS = [
  { name: 'Ctoy', pass: 'Yhc061900', role: 'user' },
  { name: 'system_mini', pass: 'SYSTEM_mini1234', role: 'user' }
];

/** 插入一个账号（密码自动加盐哈希） */
function insertAccount(acc) {
  const now = Date.now();
  open().prepare('INSERT INTO users (name, pass, created, role, settings, updated) VALUES (?, ?, ?, ?, ?, ?)')
    .run(acc.name, hashPassword(acc.pass), now, acc.role || 'user', '{}', now);
}

/** 保证内置管理员账号存在：不存在则补建；已存在只校正角色，不覆盖密码 */
function ensureAdmin() {
  const d = open();
  const r = d.prepare('SELECT name, role FROM users WHERE name = ?').get(BUILTIN_ADMIN.name);
  if (!r) { insertAccount(BUILTIN_ADMIN); return; }
  if (r.role !== 'admin') {
    d.prepare('UPDATE users SET role = ?, updated = ? WHERE name = ?').run('admin', Date.now(), BUILTIN_ADMIN.name);
  }
}

/**
 * 初始化用户数据。
 * 首次启动时，若 users 表为空，则尝试从 users.json 迁移；无可迁移数据时，
 * 用内置默认账号创建（仅用于首次初始化，部署后请及时修改密码）：
 *   admin       / Admin1234（管理员）
 *   Ctoy        / Yhc061900
 *   system_mini / SYSTEM_mini1234
 * 老库升级时自动补建 admin 账号，不覆盖任何已存在的密码。
 */
function init(forceDefaults) {
  open();
  if (forceDefaults) {
    // 强制重建默认账号
    open().prepare('DELETE FROM users').run();
    for (const acc of DEFAULT_USERS) insertAccount(acc);
    insertAccount(BUILTIN_ADMIN);
    return loadUsers();
  }
  migrateFromJson();
  if (open().prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
    for (const acc of DEFAULT_USERS) insertAccount(acc);
  }
  ensureAdmin();
  return loadUsers();
}

/** 校验登录，成功返回 {username}，失败返回 null */
function login(username, password) {
  const r = open().prepare('SELECT * FROM users WHERE name = ?').get(username);
  if (!r || !verifyPassword(password, r.pass)) return null;
  return { username };
}

/** 修改密码（管理员或本人） */
function setPassword(username, newPassword) {
  const r = open().prepare('SELECT * FROM users WHERE name = ?').get(username);
  if (!r) return false;
  open().prepare('UPDATE users SET pass = ?, updated = ? WHERE name = ?')
    .run(hashPassword(newPassword), Date.now(), username);
  return true;
}

/** 读取用户设置 */
function getSettings(username) {
  const r = open().prepare('SELECT settings FROM users WHERE name = ?').get(username);
  if (!r || !r.settings) return {};
  try { return JSON.parse(r.settings); } catch (e) { return {}; }
}

/** 合并保存用户设置（白名单字段由接口层校验） */
function setSettings(username, patch) {
  const r = open().prepare('SELECT * FROM users WHERE name = ?').get(username);
  if (!r) return false;
  let cur = {};
  try { cur = r.settings ? JSON.parse(r.settings) : {}; } catch (e) { cur = {}; }
  cur = Object.assign({}, cur, patch);
  open().prepare('UPDATE users SET settings = ?, updated = ? WHERE name = ?')
    .run(JSON.stringify(cur), Date.now(), username);
  return true;
}

// ---------- 角色与用户管理 ----------

/** 读取角色（默认 user） */
function getRole(username) {
  const r = open().prepare('SELECT role FROM users WHERE name = ?').get(username);
  return r && r.role ? String(r.role) : 'user';
}

/** 是否管理员 */
function isAdmin(username) {
  return getRole(username) === 'admin';
}

/** 新建用户（管理员接口使用）；用户名已存在返回 false */
function createUser(name, password, role) {
  if (!name || !password) return false;
  if (open().prepare('SELECT 1 AS x FROM users WHERE name = ?').get(name)) return false;
  insertAccount({ name, pass: password, role: role === 'admin' ? 'admin' : 'user' });
  return true;
}

/** 删除用户；用户不存在返回 false */
function deleteUser(name) {
  if (!name) return false;
  const r = open().prepare('DELETE FROM users WHERE name = ?').run(name);
  return !!(r && r.changes > 0);
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
  getRole,
  isAdmin,
  createUser,
  deleteUser,
  DB_FILE,
  USERS_FILE: DB_FILE
};
