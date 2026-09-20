// CircleChat 私人聊天服务器 — 站内信模块（Nitro 版）
// 提供：系统公告（announcements，全局广播）+ 个人通知（notifications，按用户分发）。
// 公告由管理员发布，全员可见；通知按 target 用户名分发（如处罚结果）。
// 表结构由本模块 open() 自行维护（启动时首次访问自动建表）。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 路径锚定到运行根目录（package.json 启动目录 = 项目根）
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'chatplus.db');

let db: DatabaseSync | null = null;
function open(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      title   TEXT NOT NULL,
      content TEXT,
      actor   TEXT,
      created INTEGER,
      updated INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_announce_created ON announcements(created);
    CREATE TABLE IF NOT EXISTS notifications (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      target  TEXT NOT NULL,
      kind    TEXT,
      title   TEXT,
      body    TEXT,
      created INTEGER,
      read    INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_notif_target ON notifications(target);
  `);
  return db;
}

// ---------- 系统公告 ----------

/** 公告列表（新→旧）。 */
export function listAnnouncements(): Record<string, unknown>[] {
  const rows = open().prepare('SELECT * FROM announcements ORDER BY created DESC').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id, title: r.title, content: r.content, actor: r.actor, created: r.created, updated: r.updated
  }));
}

/** 发布公告（权限由调用方校验）。 */
export function createAnnouncement(params: { title: string; content?: string; actor: string }): { ok: boolean; code?: string; id?: number } {
  const title = String(params.title || '').trim();
  if (!title) return { ok: false, code: 'api.invalidParams' };
  const now = Date.now();
  const res = open().prepare(
    'INSERT INTO announcements (title, content, actor, created, updated) VALUES (?, ?, ?, ?, ?)'
  ).run(title, String(params.content || '').slice(0, 2000), String(params.actor), now, now);
  return { ok: true, id: Number(res.lastInsertRowid) };
}

/** 删除公告。 */
export function deleteAnnouncement(id: number): boolean {
  const r = open().prepare('DELETE FROM announcements WHERE id = ?').run(Number(id));
  return Number(r.changes) > 0;
}

// ---------- 个人通知 ----------

/** 某用户的通知（新→旧）。 */
export function listNotificationsFor(target: string): Record<string, unknown>[] {
  const rows = open().prepare(
    'SELECT * FROM notifications WHERE target = ? ORDER BY created DESC'
  ).all(String(target)) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id, target: r.target, kind: r.kind, title: r.title, body: r.body,
    created: r.created, read: !!r.read
  }));
}

/** 全部标记已读，返回本次标记的数量。 */
export function markNotificationsRead(target: string): number {
  const res = open().prepare(
    'UPDATE notifications SET read = 1 WHERE target = ? AND read = 0'
  ).run(String(target));
  return Number(res.changes);
}

/** 写入一条通知（target 为空则不入库）。 */
export function notify(params: { target: string; kind?: string; title?: string; body?: string }): void {
  const target = String(params.target || '').trim();
  if (!target) return;
  open().prepare(
    'INSERT INTO notifications (target, kind, title, body, created, read) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(target, String(params.kind || ''), String(params.title || ''), String(params.body || ''), Date.now());
}