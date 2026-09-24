// CircleChat — 认证模块（Nitro 版，对应 lib/auth.js）
// 密码不以明文存储：sha256(盐 + 密码)，存储格式为 盐$哈希。持久化到 data/chatplus.db。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 路径锚定到运行根目录（package.json 启动目录 = 项目根）
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'chatplus.db');

const SESSION_TTL = 7 * 24 * 3600 * 1000; // 会话有效期 7 天

// ---------- 密码哈希 ----------

/** SHA256 摘要（hex） */
export function sha256(str: string): string {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/** 生成带盐的密码哈希：盐$SHA256(盐+密码) */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + '$' + sha256(salt + password);
}

/** 校验密码 */
export function verifyPassword(password: string, stored: string): boolean {
  const idx = stored.indexOf('$');
  if (idx <= 0) return false;
  const salt = stored.slice(0, idx);
  const hash = stored.slice(idx + 1);
  return sha256(salt + password) === hash;
}

// ---------- 数据库 ----------

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
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
      updated INTEGER,
      status  TEXT,
      totp_secret TEXT,
      totp_enabled INTEGER,
      github_id    TEXT,
      github_login TEXT
    );
  `);
  return db;
}

/** 用户状态：active 正常 / pending 待审核 / rejected 已拒绝 */
export const STATUS = { ACTIVE: 'active', PENDING: 'pending', REJECTED: 'rejected' } as const;

export interface StoredUser {
  pass: string;
  created?: number;
  role?: string;
  image?: string;
  status?: string;
  settings?: Record<string, unknown>;
  updated?: number;
  /** 最后一次在线时间（ms）；在线状态由 WS 连接决定，这里只记「离线时最后一次见到」 */
  lastSeen?: number;
}

interface UserRow {
  name: string;
  pass: string;
  created: number | null;
  role: string | null;
  image: string | null;
  settings: string | null;
  updated: number | null;
  status?: string | null;
  mustChange?: number | null;
  last_seen?: number | null;
}

function rowToUser(r: UserRow | null): StoredUser | null {
  if (!r) return null;
  const u: StoredUser = { pass: r.pass };
  if (r.created != null) u.created = r.created;
  if (r.role != null) u.role = r.role;
  if (r.image != null) u.image = r.image;
  if (r.status != null) u.status = r.status;
  try { u.settings = r.settings ? JSON.parse(r.settings) : {}; } catch { u.settings = {}; }
  if (r.updated != null) u.updated = r.updated;
  if (r.last_seen != null) u.lastSeen = Number(r.last_seen);
  return u;
}

/** 记录「最后在线时间」。写库是同步的（node:sqlite），调用方负责节流 */
export function touchLastSeen(name: string, ts: number = Date.now()): void {
  if (!name) return;
  try {
    open().prepare('UPDATE users SET last_seen = ? WHERE name = ?').run(Number(ts) || Date.now(), String(name));
  } catch (e) {
    /* 写失败不影响主流程（例如库被锁） */
  }
}

/** 从已有 users.json 迁移（仅首次、表为空时） */
function migrateFromJson(): void {
  const d = open();
  if ((d.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c > 0) return;
  const jsonPath = path.join(DATA_DIR, 'users.json');
  if (!fs.existsSync(jsonPath)) return;
  let obj: Record<string, unknown> | null;
  try { obj = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { return; }
  if (!obj || typeof obj !== 'object') return;
  const names = Object.keys(obj);
  if (!names.length) return;
  const ins = d.prepare('INSERT INTO users (name, pass, created, role, image, settings, updated) VALUES (?, ?, ?, ?, ?, ?, ?)');
  d.prepare('BEGIN').run();
  try {
    for (const name of names) {
      const r = (obj[name] || {}) as Record<string, unknown>;
      ins.run(
        name,
        String(r.pass || ''),
        r.created != null ? Number(r.created) : null,
        r.role != null ? String(r.role) : null,
        r.image != null ? String(r.image) : null,
        r.settings != null ? JSON.stringify(r.settings) : null,
        r.updated != null ? Number(r.updated) : null
      );
    }
    d.prepare('COMMIT').run();
  } catch (e) {
    d.prepare('ROLLBACK').run();
    throw e;
  }
}

// ---------- 用户存储 ----------

/** 返回 { name: StoredUser } 供接口层使用 */
export function loadUsers(): Record<string, StoredUser> {
  const rows = open().prepare('SELECT name, pass, created, role, image, settings, updated, last_seen FROM users').all() as unknown as UserRow[];
  const map: Record<string, StoredUser> = {};
  for (const r of rows) map[r.name] = rowToUser(r) as StoredUser;
  return map;
}

// ---------- 内置账号 ----------

/** 内置管理员账号（role=admin：可管理用户、可撤回任意人的消息） */
const BUILTIN_ADMIN = { name: 'admin', pass: 'Admin1234', role: 'admin', mustChange: true };

interface Account {
  name: string;
  pass: string;
  role?: string;
  status?: string;
  mustChange?: boolean;
}

/** 插入一个账号（密码自动加盐哈希）；status 缺省为 active（内置账号直接可用） */
function insertAccount(acc: Account): void {
  const now = Date.now();
  open().prepare('INSERT INTO users (name, pass, created, role, settings, updated, status, mustChange) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(acc.name, hashPassword(acc.pass), now, acc.role || 'user', '{}', now, acc.status || STATUS.ACTIVE, acc.mustChange ? 1 : 0);
}

/** 保证内置管理员账号存在：不存在则补建；已存在只校正角色，不覆盖密码 */
function ensureAdmin(): void {
  const d = open();
  const r = d.prepare('SELECT name, role FROM users WHERE name = ?').get(BUILTIN_ADMIN.name) as { name: string; role: string } | undefined;
  if (!r) { insertAccount(BUILTIN_ADMIN); return; }
  if (r.role !== 'admin') {
    d.prepare('UPDATE users SET role = ?, updated = ? WHERE name = ?').run('admin', Date.now(), BUILTIN_ADMIN.name);
  }
}

/**
 * 初始化用户数据。
 * 首次启动时，若 users 表为空，则尝试从 users.json 迁移；无可迁移数据时，
 * 仅创建内置管理员账号（部署后请及时修改密码）：
 *   admin / Admin1234（管理员）
 * 老库升级时自动补建 admin 账号，不覆盖任何已存在的密码。
 */
export function init(forceDefaults?: boolean): Record<string, StoredUser> {
  open();
  if (forceDefaults) {
    open().prepare('DELETE FROM users').run();
    insertAccount(BUILTIN_ADMIN);
    return loadUsers();
  }
  migrateFromJson();
  ensureAdmin();
  try {
    const r = open().prepare('SELECT pass, mustChange FROM users WHERE name = ?').get(BUILTIN_ADMIN.name) as { pass: string; mustChange: number | null } | undefined;
    if (r && r.mustChange == null) {
      const force = verifyPassword(BUILTIN_ADMIN.pass, r.pass) ? 1 : 0;
      open().prepare('UPDATE users SET mustChange = ? WHERE name = ?').run(force, BUILTIN_ADMIN.name);
    }
  } catch { /* 列已存在时不会进入；忽略以兼容极端情况 */ }
  return loadUsers();
}

/** 校验登录，成功返回 {username, status, mustChange}，密码错误返回 null */
export function login(username: string, password: string): { username: string; status: string; mustChange: boolean } | null {
  const r = open().prepare('SELECT * FROM users WHERE name = ?').get(username) as UserRow | undefined;
  if (!r || !verifyPassword(password, r.pass)) return null;
  return { username, status: r.status != null ? r.status : STATUS.ACTIVE, mustChange: !!(r.mustChange) };
}

/** 修改密码（管理员或本人）；成功后清除强制改密标志 */
/**
 * 设置角色（'admin' 或 'user'）。
 * 「不能把自己降光、至少要留一个管理员」这类业务规则由调用方判断
 * （它需要知道是谁在操作、还剩几个管理员），这里只做纯粹的落库。
 */
export function setRole(name: string, role: string): boolean {
  const who = String(name || '').trim();
  const r = String(role) === 'admin' ? 'admin' : 'user';
  const d = open();
  const got = d.prepare('SELECT name FROM users WHERE name = ?').get(who) as { name: string } | undefined;
  if (!got) return false;
  d.prepare('UPDATE users SET role = ?, updated = ? WHERE name = ?').run(r, Date.now(), who);
  return true;
}

/** 管理员数量（role 显式为 'admin' 的；role 为 NULL 的按普通用户算） */
export function countAdmins(): number {
  const r = open().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number };
  return Number(r.c) || 0;
}

export function setPassword(username: string, newPassword: string): boolean {
  const r = open().prepare('SELECT * FROM users WHERE name = ?').get(username) as UserRow | undefined;
  if (!r) return false;
  open().prepare('UPDATE users SET pass = ?, updated = ?, mustChange = 0 WHERE name = ?')
    .run(hashPassword(newPassword), Date.now(), username);
  return true;
}

/** 该账号是否仍需强制改密 */
export function mustChange(name: string): boolean {
  const r = open().prepare('SELECT mustChange FROM users WHERE name = ?').get(name) as { mustChange: number | null } | undefined;
  return !!(r && r.mustChange);
}

/** 内置管理员是否仍使用默认密码；是则返回该密码（供登录页提示），否则返回 null */
export function defaultAdminPassword(): string | null {
  const r = open().prepare('SELECT pass FROM users WHERE name = ?').get(BUILTIN_ADMIN.name) as { pass: string } | undefined;
  if (!r) return null;
  return verifyPassword(BUILTIN_ADMIN.pass, r.pass) ? BUILTIN_ADMIN.pass : null;
}

/** 读取用户设置 */
export function getSettings(username: string): Record<string, unknown> {
  const r = open().prepare('SELECT settings FROM users WHERE name = ?').get(username) as { settings: string | null } | undefined;
  if (!r || !r.settings) return {};
  try { return JSON.parse(r.settings); } catch { return {}; }
}

/** 合并保存用户设置（白名单字段由接口层校验） */
export function setSettings(username: string, patch: Record<string, unknown>): boolean {
  const r = open().prepare('SELECT * FROM users WHERE name = ?').get(username) as UserRow | undefined;
  if (!r) return false;
  let cur: Record<string, unknown> = {};
  try { cur = r.settings ? JSON.parse(r.settings) : {}; } catch { cur = {}; }
  cur = Object.assign({}, cur, patch);
  open().prepare('UPDATE users SET settings = ?, updated = ? WHERE name = ?')
    .run(JSON.stringify(cur), Date.now(), username);
  return true;
}

// ---------- 角色与用户管理 ----------

/** 读取角色（默认 user） */
export function getRole(username: string): string {
  const r = open().prepare('SELECT role FROM users WHERE name = ?').get(username) as { role: string | null } | undefined;
  return r && r.role ? String(r.role) : 'user';
}

/** 是否管理员 */
export function isAdmin(username: string): boolean {
  return getRole(username) === 'admin';
}

/** 新建用户（管理员接口使用）；用户名已存在返回 false */
export function createUser(name: string, password: string, role?: string): boolean {
  if (!name || !password) return false;
  if (open().prepare('SELECT 1 AS x FROM users WHERE name = ?').get(name)) return false;
  insertAccount({ name, pass: password, role: role === 'admin' ? 'admin' : 'user' });
  return true;
}

/** 删除用户；用户不存在返回 false */
export function deleteUser(name: string): boolean {
  if (!name) return false;
  const r = open().prepare('DELETE FROM users WHERE name = ?').run(name);
  return !!(r && r.changes > 0);
}

/** 设置/清除用户头像；image 传 null 或空串表示清除；用户不存在返回 false */
export function setImage(name: string, image: string | null): boolean {
  const r = open().prepare('SELECT 1 AS x FROM users WHERE name = ?').get(name);
  if (!r) return false;
  open().prepare('UPDATE users SET image = ?, updated = ? WHERE name = ?')
    .run(image == null || image === '' ? null : String(image), Date.now(), name);
  return true;
}

// ---------- 第三方登录绑定（GitHub） ----------

/**
 * 设置/清除某账号的 GitHub 绑定：id 传 null 表示解绑。
 * 「一个 GitHub 账号只能绑一个本地账号」由调用方先用 findByGithubId 检查。
 */
export function setGithubLink(name: string, id: string | null, login: string | null): void {
  open().prepare('UPDATE users SET github_id = ?, github_login = ?, updated = ? WHERE name = ?')
    .run(id ? String(id) : null, id ? String(login || '') : null, Date.now(), name);
}

/** 按 GitHub 用户 id 反查本地账号名；未绑定返回 null */
export function findByGithubId(id: string): string | null {
  const r = open().prepare('SELECT name FROM users WHERE github_id = ? LIMIT 1').get(String(id)) as { name: string } | undefined;
  return r && r.name ? String(r.name) : null;
}

/** 取某账号绑定的 GitHub 登录名；未绑定返回 null */
export function getGithubLogin(name: string): string | null {
  const r = open().prepare('SELECT github_login FROM users WHERE name = ?').get(String(name)) as { github_login: string | null } | undefined;
  return r && r.github_login ? String(r.github_login) : null;
}

// ---------- 两步验证（TOTP，RFC6238 / HMAC-SHA1） ----------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 生成长度 32（20 字节 = 160 位）的 Base32 密钥 */
export function genSecret(): string {
  const bytes = crypto.randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Base32 解码为 Buffer */
function base32Decode(secret: string): Buffer {
  const clean = String(secret || '').toUpperCase().replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = BASE32.indexOf(ch);
    if (v < 0) continue;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 大端序 8 字节计数器 */
function totpCounter(time: number): Buffer {
  let counter = Math.floor((Number(time) || Date.now()) / 1000 / 30);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter = Math.floor(counter / 256); }
  return buf;
}

/** 计算某时刻的 6 位 TOTP 验证码 */
function totpCode(secret: string, time: number): string {
  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(totpCounter(time)).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}

/** 校验验证码，允许 ±1 个时间步（±30s）偏移 */
export function verifyTotp(secret: string, code: string): boolean {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) return false;
  const now = Date.now();
  for (let d = -1; d <= 1; d++) {
    if (totpCode(secret, now + d * 30000) === c) return true;
  }
  return false;
}

/** 生成 otpauth 链接（兼容 Google Authenticator 等扫码软件） */
export function otpauthURL(username: string, secret: string): string {
  return 'otpauth://totp/CircleChat:' + encodeURIComponent(String(username || '')) +
    '?secret=' + encodeURIComponent(String(secret || '')) +
    '&issuer=CircleChat&algorithm=SHA1&digits=6&period=30';
}

/** 读取 2FA 状态：{ enabled, secret }。secret 为当前存储的密钥（无论是否启用）。 */
export function getTotp(name: string): { enabled: boolean; secret: string | null } {
  const r = open().prepare('SELECT totp_secret, totp_enabled FROM users WHERE name = ?').get(name) as { totp_secret: string | null; totp_enabled: number | null } | undefined;
  if (!r) return { enabled: false, secret: null };
  return { enabled: !!(r.totp_enabled), secret: r.totp_secret || null };
}

/** 写入 2FA 状态（enabled 置位时写入密钥，关闭时清空）；用户不存在返回 false */
export function setTotpEnabled(name: string, enabled: boolean, secret: string | null): boolean {
  const r = open().prepare('SELECT 1 AS x FROM users WHERE name = ?').get(name) as { x: number } | undefined;
  if (!r) return false;
  open().prepare('UPDATE users SET totp_enabled = ?, totp_secret = ?, updated = ? WHERE name = ?')
    .run(enabled ? 1 : 0, enabled ? String(secret || '') : (secret != null ? String(secret) : null), Date.now(), name);
  return true;
}

// ---------- 用户改名（全局引用一次性事务更新） ----------

/** 将用户 oldName 改名为 newName，并同步所有关联表中的引用；成功返回 true */
export function renameUser(oldName: string, newName: string): boolean {
  const old = String(oldName);
  const neu = String(newName);
  if (!old || !neu || old === neu) return false;
  const d = open();
  if (d.prepare('SELECT 1 AS x FROM users WHERE name = ?').get(neu)) return false; // 新名已被占用
  if (!d.prepare('SELECT 1 AS x FROM users WHERE name = ?').get(old)) return false;
  const now = Date.now();
  d.prepare('BEGIN').run();
  try {
    d.prepare('UPDATE users SET name = ?, updated = ? WHERE name = ?').run(neu, now, old);
    d.prepare('UPDATE messages SET "from" = ? WHERE "from" = ?').run(neu, old);
    const dmRows = d.prepare('SELECT idx, dm FROM messages WHERE dm IS NOT NULL').all() as { idx: number; dm: string }[];
    for (const row of dmRows) {
      const pair = String(row.dm).split(':');
      if (pair.indexOf(old) === -1) continue;
      const upd = pair.map((n) => (n === old ? neu : n)).sort();
      d.prepare('UPDATE messages SET dm = ? WHERE idx = ?').run(upd.join(':'), row.idx);
    }
    d.prepare('UPDATE reactions SET actor = ? WHERE actor = ?').run(neu, old);
    d.prepare('UPDATE groups SET owner = ? WHERE owner = ?').run(neu, old);
    d.prepare('UPDATE group_members SET name = ? WHERE name = ?').run(neu, old);
    d.prepare('UPDATE friends SET u1 = ? WHERE u1 = ?').run(neu, old);
    d.prepare('UPDATE friends SET u2 = ? WHERE u2 = ?').run(neu, old);
    d.prepare('UPDATE friend_requests SET requester = ? WHERE requester = ?').run(neu, old);
    d.prepare('UPDATE friend_requests SET target = ? WHERE target = ?').run(neu, old);
    d.prepare('UPDATE join_requests SET name = ? WHERE name = ?').run(neu, old);
    d.prepare('UPDATE reports SET msg_from = ? WHERE msg_from = ?').run(neu, old);
    d.prepare('UPDATE reports SET reporter = ? WHERE reporter = ?').run(neu, old);
    d.prepare('UPDATE penalties SET target = ? WHERE target = ?').run(neu, old);
    d.prepare('COMMIT').run();
    return true;
  } catch (e) {
    d.prepare('ROLLBACK').run();
    return false;
  }
}

/** 更新内存会话中的用户名（改名成功后，让已登录会话保持有效） */
export function renameSession(oldName: string, newName: string): void {
  for (const [token, s] of sessions) {
    if (s.username === oldName) {
      s.username = newName;
      sessions.set(token, s);
    }
  }
}

// ---------- 开放注册（需管理员审核） ----------

/** 提交注册申请：创建 status=pending 的账号；用户名已存在返回 false（邮箱存于 settings） */
export function submitRegistration(name: string, password: string, email?: string): boolean {
  if (!name || !password) return false;
  if (open().prepare('SELECT 1 AS x FROM users WHERE name = ?').get(name)) return false;
  insertAccount({ name, pass: password, role: 'user', status: STATUS.PENDING });
  if (email) {
    open().prepare('UPDATE users SET settings = ? WHERE name = ?')
      .run(JSON.stringify({ email: String(email).slice(0, 190) }), name);
  }
  return true;
}

/** 读取用户当前状态（不存在返回 null） */
export function getUserStatus(name: string): string | null {
  const r = open().prepare('SELECT status FROM users WHERE name = ?').get(name) as { status: string | null } | undefined;
  return r ? (r.status != null ? r.status : STATUS.ACTIVE) : null;
}

/** 待审核注册申请列表（按提交时间正序） */
export function reviewList(): { name: string; created?: number }[] {
  const rows = open()
    .prepare('SELECT name, created, status FROM users WHERE status = ? ORDER BY created ASC')
    .all(STATUS.PENDING) as { name: string; created: number | null; status: string }[];
  return rows.map((r) => {
    const o: { name: string; created?: number } = { name: r.name };
    if (r.created != null) o.created = r.created;
    return o;
  });
}

/** 通过注册申请：改 status 为 active；用户不存在返回 false */
export function reviewApprove(name: string): boolean {
  const d = open();
  const r = d.prepare('SELECT 1 AS x FROM users WHERE name = ? AND status = ?').get(name, STATUS.PENDING);
  if (!r) return false;
  d.prepare('UPDATE users SET status = ?, updated = ? WHERE name = ?').run(STATUS.ACTIVE, Date.now(), name);
  return true;
}

/** 拒绝注册申请：改 status 为 rejected；用户不存在返回 false */
export function reviewReject(name: string): boolean {
  const d = open();
  const r = d.prepare('SELECT 1 AS x FROM users WHERE name = ? AND status = ?').get(name, STATUS.PENDING);
  if (!r) return false;
  d.prepare('UPDATE users SET status = ?, updated = ? WHERE name = ?').run(STATUS.REJECTED, Date.now(), name);
  return true;
}

// ---------- 会话管理（内存存储） ----------

const sessions = new Map<string, { username: string; ip: string; expires: number }>();

export function createSession(username: string, ip: string): string {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, ip, expires: Date.now() + SESSION_TTL });
  return token;
}

export function getSession(token: string): { username: string; ip: string; expires: number } | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) {
    sessions.delete(token);
    return null;
  }
  return s;
}

export function destroySession(token: string): void {
  if (token) sessions.delete(token);
}

/** 销毁某用户的全部会话（改密后强制重新登录）；返回被销毁的会话数 */
export function destroyUserSessions(username: string): number {
  const name = String(username || '');
  if (!name) return 0;
  let n = 0;
  for (const [token, s] of sessions) {
    if (s.username === name) {
      sessions.delete(token);
      n++;
    }
  }
  return n;
}

/** 从 Cookie 头中解析 token */
export function tokenFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)circlechat_token=([^;\s]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** 从 Cookie 头中获取当前用户 */
export function authByCookie(cookieHeader: string | undefined): { username: string; ip: string; token: string } | null {
  const token = tokenFromCookie(cookieHeader);
  const s = getSession(token || '');
  return s ? { username: s.username, ip: s.ip, token: token as string } : null;
}

// ---------- 登录限速（防暴力破解） ----------

const failMap = new Map<string, { count: number; until: number }>(); // ip -> {count, until}
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000; // 锁定 10 分钟

export function isLocked(ip: string): boolean {
  const rec = failMap.get(ip);
  if (!rec) return false;
  // 还没锁上（until 还是 0）时**不能**当过期删掉：以前这里写成 `Date.now() > rec.until`，
  // 而每次请求开头都会调 isLocked，于是计数每次都被清零 → 攒够 5 次永远不可能，
  // 失败锁定等于没生效。只有「真的锁过、且已经过期」才清除记录。
  if (!rec.until) return false;
  if (Date.now() > rec.until) { failMap.delete(ip); return false; }
  return true;
}

export function recordFail(ip: string): void {
  const rec = failMap.get(ip) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= MAX_FAILS) rec.until = Date.now() + LOCK_MS;
  failMap.set(ip, rec);
}

export function clearFails(ip: string): void {
  failMap.delete(ip);
}

export { DB_FILE, DB_FILE as USERS_FILE };
