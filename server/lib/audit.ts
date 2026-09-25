// CircleChat — 审计日志模块（Nitro 版，对应 lib/audit.js）
// 记录用户关键操作（登录、发消息、撤回、上传、管理操作等），持久化到 data/chatplus.db 的 audit_logs 表。
// 仅管理员可查看；超出上限自动裁剪最旧记录；任何写入失败都不影响主流程。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 路径锚定到运行根目录（package.json 启动目录 = 项目根）
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'chatplus.db');

const MAX_LOGS = 5000; // 仅保留最近 5000 条
const MAX_DETAIL = 300; // 单条详情长度上限

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      ts     INTEGER NOT NULL,
      actor  TEXT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      ip     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
  `);
  return db;
}

export function load(): void {
  open();
}

/** 超出上限时裁剪最旧的记录 */
function trim(): void {
  const d = open();
  const c = (d.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as { c: number }).c;
  if (c <= MAX_LOGS) return;
  d.prepare('DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs ORDER BY id ASC LIMIT ?)').run(c - MAX_LOGS);
}

export interface AuditEntry {
  actor?: string;
  action: string;
  target?: string | number;
  detail?: string;
  ip?: string;
}

/**
 * 写入一条审计记录（同步、容错，失败不影响业务）
 */
export function add(e: AuditEntry): void {
  try {
    if (!e || !e.action) return;
    open()
      .prepare('INSERT INTO audit_logs (ts, actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        Date.now(),
        String(e.actor || ''),
        String(e.action),
        e.target != null ? String(e.target).slice(0, 60) : null,
        e.detail != null ? String(e.detail).slice(0, MAX_DETAIL) : null,
        e.ip != null ? String(e.ip) : null
      );
    trim();
  } catch {
    // 审计写入失败不能影响主流程
  }
}

export interface AuditRow {
  id?: number;
  ts: number;
  actor: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
}

export interface ListOpt {
  limit?: number;
  offset?: number;
  actor?: string;
  action?: string;
  /** 精确匹配多个动作（管理面板的类别筛选：可同时选多个类别 / 多个动作） */
  actions?: string[];
  /** 精确匹配 target（群日志按 gid 过滤用） */
  target?: string;
  /** action 前缀匹配（如 'group.' 只看群相关动作） */
  actionPrefix?: string;
  /** 排除的 action（群日志要挡掉 group.msg / group.recall，否则会被每条消息刷屏） */
  excludeActions?: string[];
}

/**
 * 查询日志（按时间倒序，最新在前）
 */
export function list(opt: ListOpt): { total: number; logs: AuditRow[] } {
  const o = opt || {};
  const limit = Math.min(Math.max(parseInt(String(o.limit), 10) || 100, 1), 500);
  const offset = Math.max(parseInt(String(o.offset), 10) || 0, 0);

  const where: string[] = [];
  const args: string[] = [];
  if (o.actor) {
    where.push('actor LIKE ?');
    args.push('%' + String(o.actor).slice(0, 40) + '%');
  }
  if (o.actions && o.actions.length) {
    // 多选优先：给了列表就用 IN，否则退回老的单个 action
    const list = o.actions.slice(0, 80).map((a) => String(a).slice(0, 40));
    where.push('action IN (' + list.map(() => '?').join(',') + ')');
    args.push(...list);
  } else if (o.action) {
    where.push('action = ?');
    args.push(String(o.action).slice(0, 40));
  }
  if (o.target) {
    where.push('target = ?');
    args.push(String(o.target).slice(0, 64));
  }
  if (o.actionPrefix) {
    where.push('action LIKE ?');
    args.push(String(o.actionPrefix).slice(0, 40) + '%');
  }
  if (o.excludeActions && o.excludeActions.length) {
    const list = o.excludeActions.slice(0, 20).map((a) => String(a).slice(0, 40));
    where.push('action NOT IN (' + list.map(() => '?').join(',') + ')');
    args.push(...list);
  }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const d = open();
  const total = (d.prepare('SELECT COUNT(*) AS c FROM audit_logs' + whereSql).get(...args) as { c: number }).c;
  const logs = d
    .prepare('SELECT id, ts, actor, action, target, detail, ip FROM audit_logs' + whereSql + ' ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(...args, limit, offset) as unknown as AuditRow[];
  return { total, logs };
}

export { MAX_LOGS, DB_FILE };
