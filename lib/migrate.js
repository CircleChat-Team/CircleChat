'use strict';
/* ============================================================
 * ChatPlus 私人聊天服务器 — 启动时数据库结构校验与自动迁移
 * 版权 © 2026 Ctoy，保留所有权利。
 *
 * 作用：每次启动时校验 data/chatplus.db 的表结构是否与当前代码
 *       期望的一致；若旧版本数据库缺少新列 / 新表，则自动
 *       ALTER TABLE 补齐，避免“更新代码后新服务端不认旧数据库”
 *       导致启动崩溃或功能异常。
 * 用法：在 server.js 启动时最早调用  require('./lib/migrate').run()
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'chatplus.db');

// schema 版本，仅作记录与提示；真正的迁移以“逐列比对”为准，天然向前兼容
const SCHEMA_VERSION = 3;

// 期望的数据库结构：表 -> { 建表语句(含 IF NOT EXISTS), 列名 -> 列类型 }
// 新增列 / 表时，只需在这里追加即可，启动时会自动补齐，无需手动处理旧库。
// 注意：所有可自动补齐的列都定义为可空（不带 NOT NULL），以免对已有数据
//       施加非空约束而迁移失败。
const SCHEMA = {
  messages: {
    create: `
      CREATE TABLE IF NOT EXISTS messages (
        idx     INTEGER PRIMARY KEY,
        id      TEXT NOT NULL,
        "from"  TEXT NOT NULL,
        type    TEXT NOT NULL,
        content TEXT NOT NULL,
        ts      INTEGER NOT NULL,
        name    TEXT,
        size    INTEGER,
        recalled     INTEGER,
        recalled_by  TEXT,
        recalled_at  INTEGER,
        file_expired INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_messages_idx ON messages(idx);
    `,
    columns: {
      idx: 'INTEGER', id: 'TEXT', 'from': 'TEXT', type: 'TEXT',
      content: 'TEXT', ts: 'INTEGER', name: 'TEXT', size: 'INTEGER',
      recalled: 'INTEGER', recalled_by: 'TEXT', recalled_at: 'INTEGER',
      file_expired: 'INTEGER'
    }
  },
  users: {
    create: `
      CREATE TABLE IF NOT EXISTS users (
        name    TEXT PRIMARY KEY,
        pass    TEXT NOT NULL,
        created INTEGER,
        role    TEXT,
        image   TEXT,
        settings TEXT,
        updated INTEGER
      );
    `,
    columns: {
      name: 'TEXT', pass: 'TEXT', created: 'INTEGER', role: 'TEXT',
      image: 'TEXT', settings: 'TEXT', updated: 'INTEGER'
    }
  }
};

function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  // 验证文件确实是 SQLite 数据库（防止旧的非 DB 文件导致后续崩溃）
  db.prepare('PRAGMA schema_version').get();
  return db;
}

function actualColumns(db, table) {
  try {
    const rows = db.prepare('PRAGMA table_info(' + table + ')').all();
    return rows.map((r) => r.name);
  } catch (e) {
    return null; // 表不存在
  }
}

function run() {
  let db;
  try {
    db = openDb();
  } catch (e) {
    console.error('[migrate] 无法打开数据库，请检查文件是否损坏：' + DB_FILE);
    console.error('          错误信息：' + (e && e.message ? e.message : e));
    throw e;
  }

  let changed = false;
  for (const table of Object.keys(SCHEMA)) {
    const def = SCHEMA[table];
    // 1) 确保表 / 索引存在
    db.exec(def.create);
    // 2) 比对列，补齐缺失列
    const actual = actualColumns(db, table);
    if (!actual) {
      console.error('[migrate] 表 ' + table + ' 创建后仍无法读取，请检查数据库文件。');
      continue;
    }
    for (const col of Object.keys(def.columns)) {
      if (!actual.includes(col)) {
        const type = def.columns[col];
        console.log('[migrate] 检测到旧库：表 ' + table + ' 缺少列 ' + col + '，正在补齐…');
        db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + type);
        changed = true;
      }
    }
  }

  // 记录 schema 版本，便于排查
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)')
    .run('schema_version', String(SCHEMA_VERSION));

  db.close();

  if (changed) {
    console.log('[migrate] 数据库结构已自动迁移完成（兼容新版本代码）。');
  } else {
    console.log('[migrate] 数据库结构校验通过，无需迁移。');
  }
}

module.exports = { run, SCHEMA_VERSION };
