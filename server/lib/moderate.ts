// CircleChat 私人聊天服务器 — 社区治理模块（Nitro 版，对应 lib/moderate.js）
// 提供：消息举报（reports）+ 管理员处罚（penalties）。
// 处罚类型：warning 警告 / mute 禁言 / ban 封禁 / ipban IP封禁。
// mute / ban / ipban 均可设置时长（最长 3650 天）或永久；warning 仅记录。
// 表结构由本模块 open() 自行维护（启动时首次访问自动建表）。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as mailbox from './mailbox';

// 路径锚定到运行根目录（package.json 启动目录 = 项目根）
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'chatplus.db');

// 处罚最长时长（天）：3650 天 ≈ 10 年
const MAX_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;
const TYPES = ['warning', 'mute', 'ban', 'ipban'];

let db: DatabaseSync | null = null;
function open(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      msg_idx     INTEGER NOT NULL,
      msg_from    TEXT,
      msg_type    TEXT,
      msg_snippet TEXT,
      reason      TEXT,
      reporter    TEXT,
      reported_ip TEXT,
      created     INTEGER,
      status      TEXT DEFAULT 'pending',
      handled_by  TEXT,
      handled_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE TABLE IF NOT EXISTS penalties (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,
      target      TEXT NOT NULL,
      reason      TEXT,
      actor       TEXT,
      created     INTEGER,
      duration_ms INTEGER,
      expires     INTEGER,
      revoked     INTEGER DEFAULT 0,
      revoked_by  TEXT,
      revoked_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_penalties_target ON penalties(target);
    CREATE INDEX IF NOT EXISTS idx_penalties_expires ON penalties(expires);
  `);
  return db;
}

// ---------- 举报 ----------

/** 提交举报。msgInfo: { idx, from, type, snippet, ip } */
export function reportMessage(reporter: string, msgInfo: { idx: unknown; from: unknown; type: unknown; snippet?: unknown; ip?: unknown }, reason: string): { ok: true } {
  const d = open();
  const now = Date.now();
  d.prepare(
    'INSERT INTO reports (msg_idx, msg_from, msg_type, msg_snippet, reason, reporter, reported_ip, created, status) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    Number(msgInfo.idx), String(msgInfo.from), String(msgInfo.type),
    String(msgInfo.snippet || '').slice(0, 500), String(reason || '').slice(0, 200),
    String(reporter), msgInfo.ip != null ? String(msgInfo.ip) : null,
    now, 'pending'
  );
  return { ok: true };
}

/** 举报列表。status 省略则返回全部，否则按状态过滤（按时间倒序）。 */
export function listReports(status?: string): Record<string, unknown>[] {
  const d = open();
  const rows = status
    ? d.prepare('SELECT * FROM reports WHERE status = ? ORDER BY created DESC').all(String(status))
    : d.prepare('SELECT * FROM reports ORDER BY created DESC').all();
  return rows as Record<string, unknown>[];
}

/** 标记举报为“忽略”。仅 pending 可操作。 */
export function dismissReport(id: number, by: string): boolean {
  const d = open();
  const r = d.prepare("SELECT 1 AS x FROM reports WHERE id = ? AND status = 'pending'").get(Number(id));
  if (!r) return false;
  d.prepare('UPDATE reports SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?')
    .run('dismissed', String(by), Date.now(), Number(id));
  return true;
}

/** 依举报作出处罚：将举报中提到的消息发送者设为处罚对象。 */
export function punishFromReport(id: number, by: string, type: string, days: number, permanent: boolean, reason: string): { ok: boolean; code?: string; id?: number } {
  const d = open();
  const r = d.prepare('SELECT * FROM reports WHERE id = ? AND status = ?').get(Number(id), 'pending') as Record<string, unknown> | undefined;
  if (!r) return { ok: false, code: 'mod.reportGone' };
  const target = type === 'ipban' ? String(r.reported_ip || '') : String(r.msg_from);
  const res = addPenalty({ type, target, reason, days, permanent, actor: by });
  if (!res.ok) return res;
  d.prepare('UPDATE reports SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?')
    .run('penalized', String(by), Date.now(), Number(id));
  return { ok: true, id: res.id };
}

// ---------- 处罚 ----------

/** 新增处罚（权限由调用方校验）。 */
export function addPenalty(params: { type: string; target: string; reason?: string; days?: number; permanent?: boolean; actor: string }): { ok: boolean; code?: string; id?: number } {
  const type = String(params.type || '');
  if (TYPES.indexOf(type) === -1) return { ok: false, code: 'mod.typeInvalid' };
  const target = String(params.target || '').trim();
  if (!target) return { ok: false, code: 'mod.targetRequired' };
  if (type === 'ipban' && !/^[0-9a-fA-F.:]+$/.test(target)) {
    return { ok: false, code: 'mod.ipInvalid' };
  }
  const now = Date.now();
  let durationMs: number | null = null;
  let expires: number | null = null;
  if (type !== 'warning') {
    if (params.permanent) {
      durationMs = null;
      expires = null;
    } else {
      const d = Number(params.days);
      if (!Number.isInteger(d) || d < 1 || d > MAX_DAYS) {
        return { ok: false, code: 'mod.daysInvalid' };
      }
      durationMs = d * DAY_MS;
      expires = now + durationMs;
    }
  }
  const res = open().prepare(
    'INSERT INTO penalties (type, target, reason, actor, created, duration_ms, expires, revoked) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
  ).run(type, target, String(params.reason || '').slice(0, 200), String(params.actor), now, durationMs, expires);
  // 对账号类处罚（非 ipban）给被罚用户写一条站内通知；IP 封禁无明确账号，不通知
  if (type !== 'ipban') {
    mailbox.notify({
      target,
      kind: 'penalty',
      title: 'mod.notify.penalty',
      body: String(params.reason || '')
    });
  }
  return { ok: true, id: Number(res.lastInsertRowid) };
}

/** 撤销处罚。 */
export function revokePenalty(id: number, by: string): boolean {
  const d = open();
  const r = d.prepare('SELECT id FROM penalties WHERE id = ? AND revoked = 0').get(Number(id));
  if (!r) return false;
  d.prepare('UPDATE penalties SET revoked = 1, revoked_by = ?, revoked_at = ? WHERE id = ?')
    .run(String(by), Date.now(), Number(id));
  return true;
}

/** 处罚列表（新→旧），附加 active 是否仍生效。 */
export function listPenalties(): Record<string, unknown>[] {
  const now = Date.now();
  const rows = open().prepare('SELECT * FROM penalties ORDER BY created DESC').all() as Record<string, unknown>[];
  return rows.map((r) => {
    const active = !r.revoked && (r.expires == null || Number(r.expires) > now);
    return {
      id: r.id, type: r.type, target: r.target, reason: r.reason, actor: r.actor,
      created: r.created, duration_ms: r.duration_ms, expires: r.expires,
      revoked: !!r.revoked, revoked_by: r.revoked_by, revoked_at: r.revoked_at,
      active, permanent: r.expires == null && !r.revoked
    };
  });
}

/** 某用户本人的处罚（新→旧）：含账号目标 + 当前 IP 的 IP 封禁，附加 active 是否仍生效。 */
export function listPenaltiesFor(user: string, ip: string | null): Record<string, unknown>[] {
  const now = Date.now();
  const rows = open().prepare(
    "SELECT * FROM penalties WHERE target = ? OR (type = 'ipban' AND target = ?) ORDER BY created DESC"
  ).all(String(user), String(ip || '')) as Record<string, unknown>[];
  return rows.map((r) => {
    const active = !r.revoked && (r.expires == null || Number(r.expires) > now);
    return {
      id: r.id, type: r.type, target: r.target, reason: r.reason, actor: r.actor,
      created: r.created, duration_ms: r.duration_ms, expires: r.expires,
      revoked: !!r.revoked, revoked_by: r.revoked_by, revoked_at: r.revoked_at,
      active, permanent: r.expires == null && !r.revoked
    };
  });
}

/** 计算某用户 + 当前 IP 的生效处罚状态（仅未撤销且未过期）。 */
export function blockFor(user: string, ip: string | null, now?: number): { muted: boolean; mutedUntil: number | null; banned: boolean; bannedUntil: number | null; ipBanned: boolean } {
  const t = now || Date.now();
  const d = open();
  const ures = d.prepare(
    "SELECT type, expires FROM penalties WHERE revoked = 0 AND (expires IS NULL OR expires > ?) AND type IN ('ban','mute') AND target = ?"
  ).all(t, String(user)) as { type: string; expires: number | null }[];
  const ires = d.prepare(
    "SELECT type, expires FROM penalties WHERE revoked = 0 AND (expires IS NULL OR expires > ?) AND type = 'ipban' AND target = ?"
  ).all(t, String(ip || '')) as { type: string; expires: number | null }[];
  let bannedUntil: number | null = null;
  let mutedUntil: number | null = null;
  for (const r of ures) {
    if (r.type === 'ban') {
      if (r.expires == null) bannedUntil = null;
      else if (bannedUntil == null || r.expires > bannedUntil) bannedUntil = r.expires;
    } else if (r.type === 'mute') {
      if (r.expires == null) mutedUntil = null;
      else if (mutedUntil == null || r.expires > mutedUntil) mutedUntil = r.expires;
    }
  }
  let ipBanned = false;
  for (const r of ires) {
    if (r.expires == null) { bannedUntil = null; ipBanned = true; break; }
    if (bannedUntil == null || r.expires > bannedUntil) bannedUntil = r.expires;
    ipBanned = true;
  }
  return {
    muted: mutedUntil != null,
    mutedUntil,
    banned: bannedUntil != null,
    bannedUntil,
    ipBanned
  };
}

/** 是否存在被封禁/被禁言（登录或发消息前调用）。 */
export function statusOf(user: string, ip: string | null): { muted: boolean; mutedUntil: number | null; banned: boolean; bannedUntil: number | null; ipBanned: boolean } {
  return blockFor(user, ip);
}

export { MAX_DAYS };
