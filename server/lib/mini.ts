/* ============================================================
 * 小程序（MiniApp）平台 —— 服务端核心
 *
 * 职责：
 *   1. 索引源（index.json）多源合并加载、校验与缓存
 *   2. 安装记录（个人 / 群作用域）与授权（permissions）记录
 *   3. 平台代管的 KV 存储（按 app + 命名空间隔离，不提供 SQL）
 *   4. 运行令牌（mini_token）签发与校验：由登录会话派生，不是用户 API Key
 *
 * 小程序本身是纯前端静态页面，运行在 sandbox="allow-scripts" 的 iframe 里，
 * 没有独立进程、不占端口、无文件系统权限；数据只能经本模块的端点读写。
 * ============================================================ */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as appconfig from './appconfig';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'chatplus.db');
const PUB_DIR = path.join(process.cwd(), 'public');

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS mini_installs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id     TEXT NOT NULL,
      version    TEXT NOT NULL,
      name       TEXT NOT NULL,
      icon       TEXT,
      entry      TEXT NOT NULL,
      manifest   TEXT NOT NULL,
      perms      TEXT NOT NULL,
      source_id  TEXT,
      scope_type TEXT NOT NULL,
      scope_id   TEXT NOT NULL,
      username   TEXT NOT NULL,
      enabled    INTEGER DEFAULT 1,
      created    INTEGER NOT NULL,
      updated    INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mini_install_unique ON mini_installs(app_id, scope_type, scope_id);
    CREATE INDEX IF NOT EXISTS idx_mini_install_scope ON mini_installs(scope_type, scope_id);
    CREATE INDEX IF NOT EXISTS idx_mini_install_user ON mini_installs(username);
    CREATE TABLE IF NOT EXISTS mini_kv (
      app_id     TEXT NOT NULL,
      ns         TEXT NOT NULL,
      k          TEXT NOT NULL,
      v          TEXT NOT NULL,
      updated    INTEGER NOT NULL,
      updated_by TEXT,
      PRIMARY KEY (app_id, ns, k)
    );
    CREATE INDEX IF NOT EXISTS idx_mini_kv_ns ON mini_kv(app_id, ns);
  `);
  return db;
}

export function load(): void {
  open();
}

/* ------------------------------ 权限 ------------------------------ */

export const PERMISSIONS = [
  'profile.read',   // 读取调用者自己的昵称 / 头像
  'chat.read',      // 读取当前会话信息、最近消息与成员
  'message.send',   // 以调用者身份向当前会话发消息
  'kv.read',        // 读取本 app 命名空间的 KV
  'kv.write'        // 写入 / 删除本 app 命名空间的 KV
] as const;

export type Permission = (typeof PERMISSIONS)[number];

function isPermission(x: unknown): x is Permission {
  return typeof x === 'string' && (PERMISSIONS as readonly string[]).indexOf(x) !== -1;
}

/* --------------------------- 索引源配置 --------------------------- */

export interface MiniSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  priority: number;
  official: boolean;
}

export interface MiniAppManifest {
  id: string;
  name: string;
  summary: string;
  icon: string;
  version: string;
  entry: string;
  permissions: Permission[];
  /** 群内 #指令 的指令名（不含 #），缺省表示不支持指令调用 */
  command?: string;
  window?: { width: number; height: number };
  author?: string;
  homepage?: string;
  description?: string;
}

export interface MiniApp extends MiniAppManifest {
  sourceId: string;
  sourceName: string;
  official: boolean;
}

export interface SourceStatus {
  id: string;
  name: string;
  official: boolean;
  enabled: boolean;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
}

export interface IndexResult {
  apps: MiniApp[];
  sources: SourceStatus[];
  updatedAt: number;
  cached: boolean;
}

const SOURCES_KEY = 'mini_sources';
/**
 * 官方源：索引清单放在独立仓库 CircleChat-MiniProgram，用 main 分支的 raw 链接加载。
 * 注意 raw.githubusercontent.com 把所有文件都发成 text/plain，
 * 所以只有 index.json 适合直接 fetch；小程序页面由平台取回后以 srcdoc 渲染（见 MiniAppFrame.vue）。
 */
const OFFICIAL_URL = 'https://raw.githubusercontent.com/CircleChat-Team/CircleChat-MiniProgram/main/index.json';

export function defaultSources(): MiniSource[] {
  return [{ id: 'official', name: '官方源', url: OFFICIAL_URL, enabled: true, priority: 0, official: true }];
}

export function getSources(): MiniSource[] {
  const raw = appconfig.get(SOURCES_KEY);
  if (!raw) return defaultSources();
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { return defaultSources(); }
  if (!Array.isArray(parsed)) return defaultSources();
  const out: MiniSource[] = [];
  for (const it of parsed) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    if (!url) continue;
    out.push({
      id: String(o.id || 'src-' + out.length).slice(0, 40),
      name: String(o.name || url).slice(0, 60),
      url,
      enabled: o.enabled !== false,
      priority: Number.isFinite(Number(o.priority)) ? Number(o.priority) : 100,
      official: o.official === true
    });
  }
  return out.length ? out : defaultSources();
}

export function setSources(list: MiniSource[]): void {
  const clean = (Array.isArray(list) ? list : [])
    .filter((s) => s && typeof s.url === 'string' && s.url.trim())
    .slice(0, 20)
    .map((s, i) => ({
      id: String(s.id || 'src-' + i).slice(0, 40),
      name: String(s.name || s.url).slice(0, 60),
      url: String(s.url).trim().slice(0, 500),
      enabled: s.enabled !== false,
      priority: Number.isFinite(Number(s.priority)) ? Number(s.priority) : 100,
      official: s.official === true
    }));
  appconfig.set(SOURCES_KEY, JSON.stringify(clean));
}

/* --------------------------- 索引加载 --------------------------- */

const FETCH_TIMEOUT_MS = 5000;
const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_APPS_PER_SOURCE = 200;
const MAX_APPS_TOTAL = 500;
const INDEX_TTL_MS = 30 * 60 * 1000;

let cache: IndexResult | null = null;

function trimText(v: unknown, max: number): string {
  return String(v == null ? '' : v).slice(0, max);
}

/** 读取一个索引源：本地相对路径走 public/，其余走 http(s) */
async function fetchIndexText(url: string): Promise<string> {
  if (url.startsWith('/')) {
    const rel = url.replace(/^\/+/, '');
    if (rel.indexOf('..') !== -1) throw new Error('非法路径');
    const file = path.join(PUB_DIR, rel);
    if (file.indexOf(PUB_DIR) !== 0) throw new Error('非法路径');
    if (!fs.existsSync(file)) throw new Error('文件不存在');
    const buf = fs.readFileSync(file);
    if (buf.length > MAX_INDEX_BYTES) throw new Error('索引过大');
    return buf.toString('utf8');
  }
  if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http(s) 或站内相对路径');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    if (text.length > MAX_INDEX_BYTES) throw new Error('索引过大');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** 校验并归一化索引里的单个 app（即 manifest）；不合格返回 null */
function normalizeApp(raw: unknown, src: MiniSource): MiniApp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = trimText(o.id, 64).trim();
  const name = trimText(o.name, 40).trim();
  const entry = trimText(o.entry, 500).trim();
  if (!id || !name || !entry) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
  // 入口只接受站内相对路径或 http(s)，挡掉 javascript: / data: 等
  if (!(entry.startsWith('/') || /^https?:\/\//i.test(entry))) return null;

  const permsRaw = Array.isArray(o.permissions) ? o.permissions : [];
  const perms: Permission[] = [];
  for (const p of permsRaw) if (isPermission(p) && perms.indexOf(p) === -1) perms.push(p);

  let command: string | undefined;
  const cmd = trimText(o.command, 24).trim();
  if (/^[A-Za-z0-9_-]+$/.test(cmd)) command = cmd.toLowerCase();

  const app: MiniApp = {
    id,
    name,
    summary: trimText(o.summary, 120),
    icon: trimText(o.icon, 500),
    version: trimText(o.version, 20) || '1.0.0',
    entry,
    permissions: perms,
    sourceId: src.id,
    sourceName: src.name,
    official: src.official
  };
  if (command) app.command = command;
  const w = o.window as Record<string, unknown> | undefined;
  if (w && typeof w === 'object') {
    const width = Math.min(Math.max(Number(w.width) || 420, 280), 1200);
    const height = Math.min(Math.max(Number(w.height) || 640, 320), 900);
    app.window = { width, height };
  }
  const author = trimText(o.author, 60);
  if (author) app.author = author;
  const homepage = trimText(o.homepage, 500);
  if (/^https?:\/\//i.test(homepage)) app.homepage = homepage;
  const desc = trimText(o.description, 400);
  if (desc) app.description = desc;
  return app;
}

async function loadAll(): Promise<IndexResult> {
  const sources = getSources()
    .filter((s) => s.enabled)
    .sort((a, b) => (a.official === b.official ? a.priority - b.priority : a.official ? -1 : 1));

  const status: SourceStatus[] = [];
  const merged = new Map<string, MiniApp>();

  for (const src of sources) {
    const t0 = Date.now();
    const st: SourceStatus = { id: src.id, name: src.name, official: src.official, enabled: true, ok: false, count: 0, ms: 0 };
    try {
      const text = await fetchIndexText(src.url);
      const json = JSON.parse(text) as { apps?: unknown };
      const rawApps = json && json.apps;
      const list: unknown[] = Array.isArray(rawApps) ? rawApps : [];
      for (const raw of list.slice(0, MAX_APPS_PER_SOURCE)) {
        const app = normalizeApp(raw, src);
        if (!app) continue;
        if (merged.has(app.id)) continue; // 高优先级源优先，后者不覆盖
        if (merged.size >= MAX_APPS_TOTAL) break;
        merged.set(app.id, app);
        st.count++;
      }
      st.ok = true;
    } catch (e) {
      st.error = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message).slice(0, 120) : '加载失败';
    }
    st.ms = Date.now() - t0;
    status.push(st);
  }
  // 未启用的源也要回显状态，方便管理面板排查
  for (const src of getSources().filter((s) => !s.enabled)) {
    status.push({ id: src.id, name: src.name, official: src.official, enabled: false, ok: false, count: 0, ms: 0 });
  }

  return { apps: [...merged.values()], sources: status, updatedAt: Date.now(), cached: false };
}

/** 取合并后的索引；force=true 强制回源（管理面板「立即刷新」） */
export async function getIndex(force = false): Promise<IndexResult> {
  if (!force && cache && Date.now() - cache.updatedAt < INDEX_TTL_MS) {
    return { ...cache, cached: true };
  }
  const r = await loadAll();
  cache = r;
  return { ...r, cached: false };
}

export function refreshIndex(): Promise<IndexResult> {
  return getIndex(true);
}

export function cachedApps(): MiniApp[] {
  return cache ? cache.apps : [];
}

export async function findApp(appId: string): Promise<MiniApp | null> {
  const idx = await getIndex();
  return idx.apps.find((a) => a.id === appId) || null;
}

/* --------------------------- 安装记录 --------------------------- */

export type MiniScopeType = 'user' | 'group';

export interface MiniInstall {
  id: number;
  appId: string;
  version: string;
  name: string;
  icon: string;
  entry: string;
  manifest: MiniAppManifest;
  perms: Permission[];
  sourceId: string;
  scopeType: MiniScopeType;
  scopeId: string;
  username: string;
  enabled: boolean;
  created: number;
  updated: number;
}

interface InstallRow {
  id: number;
  app_id: string;
  version: string;
  name: string;
  icon: string | null;
  entry: string;
  manifest: string;
  perms: string;
  source_id: string | null;
  scope_type: string;
  scope_id: string;
  username: string;
  enabled: number | null;
  created: number;
  updated: number;
}

function rowToInstall(r: InstallRow): MiniInstall {
  let manifest: MiniAppManifest;
  try {
    manifest = JSON.parse(r.manifest) as MiniAppManifest;
  } catch {
    manifest = { id: r.app_id, name: r.name, summary: '', icon: r.icon || '', version: r.version, entry: r.entry, permissions: [] };
  }
  let perms: Permission[] = [];
  try {
    const arr = JSON.parse(r.perms) as unknown;
    if (Array.isArray(arr)) perms = arr.filter(isPermission);
  } catch {
    perms = [];
  }
  return {
    id: r.id,
    appId: r.app_id,
    version: r.version,
    name: r.name,
    icon: r.icon || '',
    entry: r.entry,
    manifest,
    perms,
    sourceId: r.source_id || '',
    scopeType: r.scope_type === 'group' ? 'group' : 'user',
    scopeId: r.scope_id,
    username: r.username,
    enabled: r.enabled !== 0,
    created: r.created,
    updated: r.updated
  };
}

/** 作用域键：个人为空串（按安装者区分），群为 gid */
export function getInstall(appId: string, scopeType: MiniScopeType, scopeId: string): MiniInstall | null {
  const r = open()
    .prepare('SELECT * FROM mini_installs WHERE app_id = ? AND scope_type = ? AND scope_id = ?')
    .get(String(appId), scopeType, String(scopeId)) as InstallRow | undefined;
  return r ? rowToInstall(r) : null;
}

export function listInstalls(q: { scopeType?: MiniScopeType; scopeId?: string; username?: string }): MiniInstall[] {
  const where: string[] = [];
  const args: string[] = [];
  if (q.scopeType) { where.push('scope_type = ?'); args.push(q.scopeType); }
  if (q.scopeId != null) { where.push('scope_id = ?'); args.push(String(q.scopeId)); }
  if (q.username) { where.push('username = ?'); args.push(q.username); }
  const sql = 'SELECT * FROM mini_installs' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY updated DESC';
  const rows = open().prepare(sql).all(...args) as unknown as InstallRow[];
  return rows.map(rowToInstall);
}

/** 安装 / 覆盖安装：写入 manifest 快照与授权记录 */
export function installApp(username: string, app: MiniApp, scopeType: MiniScopeType, scopeId: string, granted: Permission[]): MiniInstall {
  const now = Date.now();
  const perms = granted.filter(isPermission);
  const manifest: MiniAppManifest = {
    id: app.id, name: app.name, summary: app.summary, icon: app.icon,
    version: app.version, entry: app.entry, permissions: app.permissions
  };
  if (app.command) manifest.command = app.command;
  if (app.window) manifest.window = app.window;
  if (app.author) manifest.author = app.author;
  if (app.homepage) manifest.homepage = app.homepage;
  if (app.description) manifest.description = app.description;

  open()
    .prepare(`INSERT INTO mini_installs (app_id, version, name, icon, entry, manifest, perms, source_id, scope_type, scope_id, username, enabled, created, updated)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
              ON CONFLICT(app_id, scope_type, scope_id) DO UPDATE SET
                version = excluded.version, name = excluded.name, icon = excluded.icon, entry = excluded.entry,
                manifest = excluded.manifest, perms = excluded.perms, source_id = excluded.source_id,
                username = excluded.username, enabled = 1, updated = excluded.updated`)
    .run(
      app.id, app.version, app.name, app.icon || null, app.entry,
      JSON.stringify(manifest), JSON.stringify(perms), app.sourceId,
      scopeType, String(scopeId), username, now, now
    );
  const inst = getInstall(app.id, scopeType, String(scopeId));
  if (!inst) throw new Error('安装记录写入失败');
  return inst;
}

/** 卸载：同时清掉该 app 在该命名空间下的 KV 数据，避免残留 */
export function uninstallApp(appId: string, scopeType: MiniScopeType, scopeId: string): boolean {
  const d = open();
  const r = d.prepare('DELETE FROM mini_installs WHERE app_id = ? AND scope_type = ? AND scope_id = ?')
    .run(String(appId), scopeType, String(scopeId));
  kvPurge(appId, kvNamespace(scopeType, String(scopeId), ''));
  return Number(r.changes) > 0;
}

export function regrant(appId: string, scopeType: MiniScopeType, scopeId: string, granted: Permission[]): boolean {
  const perms = granted.filter(isPermission);
  const r = open()
    .prepare('UPDATE mini_installs SET perms = ?, updated = ? WHERE app_id = ? AND scope_type = ? AND scope_id = ?')
    .run(JSON.stringify(perms), Date.now(), String(appId), scopeType, String(scopeId));
  return Number(r.changes) > 0;
}

export function hasPerm(inst: MiniInstall | null, perm: Permission): boolean {
  return !!inst && inst.enabled && inst.perms.indexOf(perm) !== -1;
}

/** 用户在某作用域可见的小程序（个人级安装 + 所在群的安装） */
export function visibleInstalls(username: string, gid: string | null): MiniInstall[] {
  const mine = listInstalls({ scopeType: 'user', username });
  const groups = gid ? listInstalls({ scopeType: 'group', scopeId: gid }) : [];
  return [...mine, ...groups];
}

/* ------------------------------ KV ------------------------------ */

export const KV_LIMITS = { keyMax: 256, valMax: 64 * 1024, maxKeys: 500, maxBytes: 1024 * 1024 };

/** 命名空间：个人级按用户隔离，群级按群隔离；再叠加 app_id，app 之间互不可见 */
export function kvNamespace(scopeType: MiniScopeType, scopeId: string, username: string): string {
  return scopeType === 'group' ? 'g:' + String(scopeId || '') : 'u:' + String(username || scopeId || '');
}

export function kvGet(appId: string, ns: string, k: string): string | null {
  const r = open().prepare('SELECT v FROM mini_kv WHERE app_id = ? AND ns = ? AND k = ?')
    .get(String(appId), ns, String(k).slice(0, KV_LIMITS.keyMax)) as { v: string } | undefined;
  return r ? r.v : null;
}

export interface KvItem { k: string; v: string; updated: number }

export function kvList(appId: string, ns: string): KvItem[] {
  const rows = open().prepare('SELECT k, v, updated FROM mini_kv WHERE app_id = ? AND ns = ? ORDER BY k ASC LIMIT ?')
    .all(String(appId), ns, KV_LIMITS.maxKeys) as unknown as KvItem[];
  return rows;
}

export type KvResult = { ok: true } | { ok: false; error: string };

export function kvSet(appId: string, ns: string, k: string, v: string, by: string): KvResult {
  const key = String(k || '');
  const val = String(v == null ? '' : v);
  if (!key) return { ok: false, error: 'api.mini.kv.invalid' };
  if (key.length > KV_LIMITS.keyMax) return { ok: false, error: 'api.mini.kv.keyTooLong' };
  if (val.length > KV_LIMITS.valMax) return { ok: false, error: 'api.mini.kv.valueTooLarge' };

  const d = open();
  const stat = d.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(LENGTH(v)), 0) AS bytes FROM mini_kv WHERE app_id = ? AND ns = ?')
    .get(String(appId), ns) as { c: number; bytes: number } | undefined;
  const old = d.prepare('SELECT LENGTH(v) AS n FROM mini_kv WHERE app_id = ? AND ns = ? AND k = ?')
    .get(String(appId), ns, key) as { n: number } | undefined;
  const count = (stat ? stat.c : 0) + (old ? 0 : 1);
  const bytes = (stat ? stat.bytes : 0) - (old ? old.n : 0) + val.length;
  if (count > KV_LIMITS.maxKeys) return { ok: false, error: 'api.mini.kv.tooManyKeys' };
  if (bytes > KV_LIMITS.maxBytes) return { ok: false, error: 'api.mini.kv.quotaExceeded' };

  d.prepare('INSERT OR REPLACE INTO mini_kv (app_id, ns, k, v, updated, updated_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(String(appId), ns, key, val, Date.now(), String(by || ''));
  return { ok: true };
}

export function kvDel(appId: string, ns: string, k: string): boolean {
  const r = open().prepare('DELETE FROM mini_kv WHERE app_id = ? AND ns = ? AND k = ?')
    .run(String(appId), ns, String(k).slice(0, KV_LIMITS.keyMax));
  return Number(r.changes) > 0;
}

export function kvPurge(appId: string, ns: string): void {
  open().prepare('DELETE FROM mini_kv WHERE app_id = ? AND ns = ?').run(String(appId), ns);
}

/* --------------------------- 运行令牌 --------------------------- */

const TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_SECRET_KEY = 'mini_token_secret';

export interface MiniTokenPayload {
  /** 用户名 */
  u: string;
  /** appId */
  a: string;
  /** 作用域类型 */
  s: MiniScopeType;
  /** 作用域 id（个人为用户名，群为 gid） */
  c: string;
  /** 已授权权限 */
  p: Permission[];
  exp: number;
}

function tokenSecret(): string {
  let s = appconfig.get(TOKEN_SECRET_KEY);
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    appconfig.set(TOKEN_SECRET_KEY, s);
  }
  return s;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signToken(p: Omit<MiniTokenPayload, 'exp'>): { token: string; expires: number } {
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = b64url(JSON.stringify({ ...p, exp }));
  const sig = b64url(crypto.createHmac('sha256', tokenSecret()).update(body).digest());
  return { token: body + '.' + sig, expires: exp };
}

export function verifyToken(token: string): MiniTokenPayload | null {
  const raw = String(token || '');
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const want = b64url(crypto.createHmac('sha256', tokenSecret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p: MiniTokenPayload;
  try {
    p = JSON.parse(Buffer.from(body, 'base64').toString('utf8')) as MiniTokenPayload;
  } catch {
    return null;
  }
  if (!p || typeof p.u !== 'string' || typeof p.a !== 'string') return null;
  if (!Number.isFinite(p.exp) || p.exp < Date.now()) return null;
  if (!Array.isArray(p.p)) p.p = [];
  return p;
}
