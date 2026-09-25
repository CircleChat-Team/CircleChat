// CircleChat — 启动时数据库结构校验与自动迁移（Nitro 版，对应 lib/migrate.js）
// 每次启动时校验 data/chatplus.db 的表结构是否与当前代码期望的一致；
// 若旧库缺列/缺表，则自动 ALTER TABLE 补齐。用法：Nitro 启动最早调用 run()。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 路径锚定到运行根目录（package.json 启动目录 = 项目根）；Nitro 打包后 import.meta.url 不再可靠
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'chatplus.db');

// schema 版本，仅作记录与提示；真正的迁移以“逐列比对”为准，天然向前兼容
const SCHEMA_VERSION = 9;

interface TableDef {
  create: string;
  columns: Record<string, string>;
}

// 期望的数据库结构：表 -> { 建表语句(含 IF NOT EXISTS), 列名 -> 列类型 }
// 新增列 / 表时，只需在这里追加即可，启动时会自动补齐，无需手动处理旧库。
const SCHEMA: Record<string, TableDef> = {
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
        md           INTEGER,
        via_app      TEXT
        );
      CREATE INDEX IF NOT EXISTS idx_messages_idx ON messages(idx);
    `,
    columns: {
      idx: 'INTEGER', id: 'TEXT', 'from': 'TEXT', type: 'TEXT',
      content: 'TEXT', ts: 'INTEGER', name: 'TEXT', size: 'INTEGER',
      recalled: 'INTEGER', recalled_by: 'TEXT', recalled_at: 'INTEGER',
      file_expired: 'INTEGER', reply_to: 'INTEGER', gid: 'TEXT', dm: 'TEXT',
      md: 'INTEGER', via_app: 'TEXT'
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
        totp_enabled INTEGER,
        github_id    TEXT,
        github_login TEXT,
        last_seen    INTEGER
      );
    `,
    columns: {
      name: 'TEXT', pass: 'TEXT', created: 'INTEGER', role: 'TEXT',
      image: 'TEXT', settings: 'TEXT', updated: 'INTEGER', status: 'TEXT',
      mustChange: 'INTEGER', totp_secret: 'TEXT', totp_enabled: 'INTEGER',
      github_id: 'TEXT', github_login: 'TEXT', last_seen: 'INTEGER'
    }
  },
  app_config: {
    create: `
      CREATE TABLE IF NOT EXISTS app_config (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `,
    columns: { key: 'TEXT', value: 'TEXT' }
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
        avatar  TEXT,
        announcement TEXT,
        mute_all INTEGER DEFAULT 0,
        member_invite_approve INTEGER DEFAULT 0
      );
    `,
    columns: {
      id: 'TEXT', name: 'TEXT', owner: 'TEXT', created: 'INTEGER', updated: 'INTEGER',
      avatar: 'TEXT', announcement: 'TEXT', mute_all: 'INTEGER', member_invite_approve: 'INTEGER'
    }
  },
  group_members: {
    create: `
      CREATE TABLE IF NOT EXISTS group_members (
        gid      TEXT NOT NULL,
        name     TEXT NOT NULL,
        joined   INTEGER,
        role     TEXT DEFAULT 'member',
        nickname TEXT,
        muted    INTEGER DEFAULT 0,
        PRIMARY KEY (gid, name)
      );
      CREATE INDEX IF NOT EXISTS idx_gm_name ON group_members(name);
    `,
    columns: {
      gid: 'TEXT', name: 'TEXT', joined: 'INTEGER', role: 'TEXT', nickname: 'TEXT', muted: 'INTEGER'
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
  group_invites: {
    create: `
      CREATE TABLE IF NOT EXISTS group_invites (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        gid      TEXT NOT NULL,
        inviter  TEXT NOT NULL,
        invitee  TEXT NOT NULL,
        created  INTEGER NOT NULL,
        status   TEXT DEFAULT 'pending',
        note     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_gi_gid      ON group_invites(gid);
      CREATE INDEX IF NOT EXISTS idx_gi_invitee  ON group_invites(invitee);
      CREATE INDEX IF NOT EXISTS idx_gi_gid_status ON group_invites(gid, status);
    `,
    columns: {
      id: 'INTEGER', gid: 'TEXT', inviter: 'TEXT', invitee: 'TEXT', created: 'INTEGER', status: 'TEXT', note: 'TEXT'
    }
  },
  group_remarks: {
    create: `
      CREATE TABLE IF NOT EXISTS group_remarks (
        u       TEXT NOT NULL,
        gid     TEXT NOT NULL,
        remark  TEXT,
        updated INTEGER,
        PRIMARY KEY (u, gid)
      );
    `,
    columns: { u: 'TEXT', gid: 'TEXT', remark: 'TEXT', updated: 'INTEGER' }
  },
  friend_remarks: {
    create: `
      CREATE TABLE IF NOT EXISTS friend_remarks (
        u1      TEXT NOT NULL,
        u2      TEXT NOT NULL,
        remark  TEXT,
        updated INTEGER,
        PRIMARY KEY (u1, u2)
      );
    `,
    columns: { u1: 'TEXT', u2: 'TEXT', remark: 'TEXT', updated: 'INTEGER' }
  },
  mini_installs: {
    create: `
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
    `,
    columns: {
      id: 'INTEGER', app_id: 'TEXT', version: 'TEXT', name: 'TEXT', icon: 'TEXT',
      entry: 'TEXT', manifest: 'TEXT', perms: 'TEXT', source_id: 'TEXT',
      scope_type: 'TEXT', scope_id: 'TEXT', username: 'TEXT',
      enabled: 'INTEGER', created: 'INTEGER', updated: 'INTEGER'
    }
  },
  mini_kv: {
    create: `
      CREATE TABLE IF NOT EXISTS mini_kv (
        app_id    TEXT NOT NULL,
        ns        TEXT NOT NULL,
        k         TEXT NOT NULL,
        v         TEXT NOT NULL,
        updated   INTEGER NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (app_id, ns, k)
      );
      CREATE INDEX IF NOT EXISTS idx_mini_kv_ns ON mini_kv(app_id, ns);
    `,
    columns: {
      app_id: 'TEXT', ns: 'TEXT', k: 'TEXT', v: 'TEXT', updated: 'INTEGER', updated_by: 'TEXT'
    }
  },
  api_keys: {
    create: `
      CREATE TABLE IF NOT EXISTS api_keys (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT NOT NULL,
        name       TEXT NOT NULL,
        key_hash   TEXT NOT NULL,
        prefix     TEXT NOT NULL,
        scopes     TEXT NOT NULL,
        rate_limit INTEGER,
        created    INTEGER NOT NULL,
        last_used  INTEGER,
        expires    INTEGER,
        revoked    INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_ak_username ON api_keys(username);
      CREATE INDEX IF NOT EXISTS idx_ak_hash ON api_keys(key_hash);
    `,
    columns: {
      id: 'INTEGER', username: 'TEXT', name: 'TEXT', key_hash: 'TEXT', prefix: 'TEXT',
      scopes: 'TEXT', rate_limit: 'INTEGER', created: 'INTEGER', last_used: 'INTEGER',
      expires: 'INTEGER', revoked: 'INTEGER'
    }
  }
};

function openDb(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  // 验证文件确实是 SQLite 数据库（防止旧的非 DB 文件导致后续崩溃）
  db.prepare('PRAGMA schema_version').get();
  return db;
}

function actualColumns(db: DatabaseSync, table: string): string[] | null {
  try {
    const rows = db.prepare('PRAGMA table_info(' + table + ')').all() as { name: string }[];
    return rows.map((r) => r.name);
  } catch {
    return null; // 表不存在
  }
}

export function run(): void {
  let db: DatabaseSync;
  try {
    db = openDb();
  } catch (e) {
    const msg = e && typeof e === 'object' && 'message' in e ? (e as { message: string }).message : String(e);
    console.error('[migrate] 无法打开数据库，请检查文件是否损坏：' + DB_FILE);
    console.error('          错误信息：' + msg);
    throw e;
  }

  let changed = false;
  for (const table of Object.keys(SCHEMA)) {
    const def = SCHEMA[table];
    // 1) 确保表 / 索引存在
    db.exec(def.create);
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

export { SCHEMA_VERSION, DB_FILE };
