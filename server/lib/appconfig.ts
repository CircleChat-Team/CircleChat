/* ============================================================
 * 全局配置（整站级，区别于用户级的 users.settings）
 *
 * 目前用于第三方登录（GitHub OAuth）的 client_id / client_secret：
 * 由管理员在管理面板里填写，存在同一个 SQLite 库里（表由 migrate.ts 建）。
 * secret 只在服务端使用（换取 access_token），**任何接口都不会把它下发**。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'chatplus.db');

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)');
  return db;
}

/** 取配置项；不存在返回 '' */
export function get(key: string): string {
  try {
    const r = open().prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string } | undefined;
    return r && r.value != null ? String(r.value) : '';
  } catch (e) {
    return ''; // 库还没建好时不要因为读配置把请求打挂
  }
}

/** 写配置项；value 为空串表示删除该配置 */
export function set(key: string, value: string): void {
  if (value) {
    open().prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(key, value);
  } else {
    open().prepare('DELETE FROM app_config WHERE key = ?').run(key);
  }
}
