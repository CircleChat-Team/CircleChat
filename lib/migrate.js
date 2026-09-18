'use strict';
/* ============================================================
 * CircleChat 私人聊天服务器 — 启动时数据库结构校验与自动迁移
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
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'chatplus.db');

// schema 版本，仅作记录与提示；真正的迁移以“逐列比对”为准，天然向前兼容
const SCHEMA_VERSION = 9;

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
        file_expired INTEGER,
        reply_to     INTEGER,
        gid          TEXT,
        dm           TEXT,
        md           INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_messages_idx ON messages(idx);
    `,
    columns: {
      idx: 'INTEGER', id: 'TEXT', 'from': 'TEXT', type: 'TEXT',
      content: 'TEXT', ts: 'INTEGER', name: 'TEXT', size: 'INTEGER',
      recalled: 'INTEGER', recalled_by: 'TEXT', recalled_at: 'INTEGER',
      file_expired: 'INTEGER', reply_to: 'INTEGER', gid: 'TEXT', dm: 'TEXT',
      md: 'INTEGER'
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
        updated INTEGER,
        status  TEXT,
        mustChange INTEGER,
        totp_secret TEXT,
        totp_enabled INTEGER
      );
    `,
    columns: {
      name: 'TEXT', pass: 'TEXT', created: 'INTEGER', role: 'TEXT',
      image: 'TEXT', settings: 'TEXT', updated: 'INTEGER', status: 'TEXT',
      mustChange: 'INTEGER', totp_secret: 'TEXT', totp_enabled: 'INTEGER'
    }
  },
  reactions: {
    create: `
      CREATE TABLE IF NOT EXISTS reactions (
        msg_idx INTEGER NOT NULL,
        emoji   TEXT NOT NULL,
        actor   TEXT NOT NULL,
        ts      INTEGER NOT NULL,
        PRIMARY KEY (msg_idx, emoji, actor)
      );
      CREATE INDEX IF NOT EXISTS idx_reactions_msg ON reactions(msg_idx);
    `,
    columns: {
      msg_idx: 'INTEGER', emoji: 'TEXT', actor: 'TEXT', ts: 'INTEGER'
    }
  },
  audit_logs: {
    create: `
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
    `,
    columns: {
      id: 'INTEGER', ts: 'INTEGER', actor: 'TEXT', action: 'TEXT',
      target: 'TEXT', detail: 'TEXT', ip: 'TEXT'
    }
  },
  groups: {
    create: `
      CREATE TABLE IF NOT EXISTS groups (
        id      TEXT PRIMARY KEY,
        name    TEXT NOT NULL,
        owner   TEXT NOT NULL,
        created INTEGER,
        updated INTEGER,
        avatar  TEXT
      );
    `,
    columns: {
      id: 'TEXT', name: 'TEXT', owner: 'TEXT', created: 'INTEGER', updated: 'INTEGER', avatar: 'TEXT'
    }
  },
  group_members: {
    create: `
      CREATE TABLE IF NOT EXISTS group_members (
        gid    TEXT NOT NULL,
        name   TEXT NOT NULL,
        joined INTEGER,
        PRIMARY KEY (gid, name)
      );
      CREATE INDEX IF NOT EXISTS idx_gm_name ON group_members(name);
    `,
    columns: {
      gid: 'TEXT', name: 'TEXT', joined: 'INTEGER'
    }
  },
  friends: {
    create: `
      CREATE TABLE IF NOT EXISTS friends (
        u1      TEXT NOT NULL,
        u2      TEXT NOT NULL,
        created INTEGER,
        PRIMARY KEY (u1, u2)
      );
      CREATE INDEX IF NOT EXISTS idx_friends_u1 ON friends(u1);
    `,
    columns: {
      u1: 'TEXT', u2: 'TEXT', created: 'INTEGER'
    }
  },
  friend_requests: {
    create: `
      CREATE TABLE IF NOT EXISTS friend_requests (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        requester TEXT NOT NULL,
        target    TEXT NOT NULL,
        created   INTEGER NOT NULL,
        status    TEXT DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_fr_target ON friend_requests(target);
      CREATE INDEX IF NOT EXISTS idx_fr_requester ON friend_requests(requester);
    `,
    columns: {
      id: 'INTEGER', requester: 'TEXT', target: 'TEXT', created: 'INTEGER', status: 'TEXT'
    }
  },
  join_requests: {
    create: `
      CREATE TABLE IF NOT EXISTS join_requests (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        gid     TEXT NOT NULL,
        name    TEXT NOT NULL,
        created INTEGER NOT NULL,
        status  TEXT DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_jr_gid   ON join_requests(gid);
      CREATE INDEX IF NOT EXISTS idx_jr_gid_status ON join_requests(gid, status);
      CREATE INDEX IF NOT EXISTS idx_jr_name  ON join_requests(name);
    `,
    columns: {
      id: 'INTEGER', gid: 'TEXT', name: 'TEXT', created: 'INTEGER', status: 'TEXT'
    }
  },
  reports: {
    create: `
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
    `,
    columns: {
      id: 'INTEGER', msg_idx: 'INTEGER', msg_from: 'TEXT', msg_type: 'TEXT', msg_snippet: 'TEXT',
      reason: 'TEXT', reporter: 'TEXT', reported_ip: 'TEXT', created: 'INTEGER', status: 'TEXT',
      handled_by: 'TEXT', handled_at: 'INTEGER'
    }
  },
  penalties: {
    create: `
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
    `,
    columns: {
      id: 'INTEGER', type: 'TEXT', target: 'TEXT', reason: 'TEXT', actor: 'TEXT', created: 'INTEGER',
      duration_ms: 'INTEGER', expires: 'INTEGER', revoked: 'INTEGER', revoked_by: 'TEXT', revoked_at: 'INTEGER'
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
