// CircleChat — 消息存储模块（Nitro 版，对应 lib/store.js）
// 消息持久化到 data/chatplus.db（SQLite，使用 Node 内置 node:sqlite），超过上限自动裁剪并清理孤立上传文件。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 路径锚定到运行根目录（package.json 启动目录 = 项目根）
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'chatplus.db');
const UPLOAD_DIR = path.join(process.cwd(), 'public/uploads');

const MAX_MESSAGES = 500; // 仅保留最近 500 条

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
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
    CREATE TABLE IF NOT EXISTS reactions (
      msg_idx INTEGER NOT NULL,
      emoji   TEXT NOT NULL,
      actor   TEXT NOT NULL,
      ts      INTEGER NOT NULL,
      PRIMARY KEY (msg_idx, emoji, actor)
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_msg ON reactions(msg_idx);
    CREATE TABLE IF NOT EXISTS uploads (
      sha  TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      ts   INTEGER NOT NULL
    );
  `);
  return db;
}

function nextIdx(): number {
  const row = open().prepare('SELECT COALESCE(MAX(idx), 0) AS m FROM messages').get() as { m: number };
  return (row && row.m ? row.m : 0) + 1;
}

// 从已有 messages.json 迁移（仅首次、表为空时）
function migrateFromJson(): void {
  const d = open();
  if ((d.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c > 0) return;
  const jsonPath = path.join(DATA_DIR, 'messages.json');
  if (!fs.existsSync(jsonPath)) return;
  let arr: unknown;
  try { arr = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { return; }
  if (!Array.isArray(arr) || !arr.length) return;
  arr.sort((a, b) => (Number((a as { idx?: unknown }).idx) || Number((a as { ts?: unknown }).ts) || 0) - (Number((b as { idx?: unknown }).idx) || Number((b as { ts?: unknown }).ts) || 0));
  const ins = d.prepare('INSERT INTO messages (idx, id, "from", type, content, ts, name, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  d.prepare('BEGIN').run();
  try {
    for (const m of arr) {
      const mm = m as Record<string, unknown>;
      ins.run(
        Number(mm.idx) || nextIdx(),
        String(mm.id || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8))),
        String(mm.from || ''),
        String(mm.type || 'text'),
        String(mm.content || ''),
        Number(mm.ts) || Date.now(),
        mm.name != null ? String(mm.name) : null,
        mm.size != null ? Number(mm.size) : null
      );
    }
    d.prepare('COMMIT').run();
  } catch (e) {
    d.prepare('ROLLBACK').run();
    throw e;
  }
  trim();
}

/**
 * 收集消息中引用的上传文件名集合（用于判断是否可安全删除文件）。
 * 已撤回、已过期的消息都不再占用文件。
 */
function referencedFiles(): Set<string> {
  const set = new Set<string>();
  const rows = open().prepare(
    "SELECT content, type FROM messages WHERE type IN ('image', 'file')" +
    " AND (recalled IS NULL OR recalled = 0) AND (file_expired IS NULL OR file_expired = 0)"
  ).all() as { content: string | null; type: string }[];
  for (const r of rows) {
    if (!r.content) continue;
    const base = path.basename(String(r.content));
    if (base && base !== r.content) set.add(base);
  }
  return set;
}

/** 删除不再被引用且属于本服务器上传目录的文件 */
function cleanupFiles(removedRows: { type: string; content: string | null }[]): void {
  const keep = referencedFiles();
  for (const m of removedRows) {
    if ((m.type === 'image' || m.type === 'file') && m.content) {
      const base = path.basename(String(m.content));
      if (keep.has(base)) continue;
      const fp = path.join(UPLOAD_DIR, base);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* 忽略 */ }
      dropUpload(base); // 物理文件已删，去重记录一并清掉，避免残留指向空文件
    }
  }
}

/** 超出上限时，删除最旧的若干条并清理孤立文件 */
function trim(): void {
  const d = open();
  const cnt = (d.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c;
  if (cnt <= MAX_MESSAGES) return;
  const over = cnt - MAX_MESSAGES;
  const removed = d.prepare('SELECT * FROM messages ORDER BY idx ASC LIMIT ?').all(over) as unknown as MsgRow[];
  const maxRemoved = removed[removed.length - 1].idx;
  d.prepare('DELETE FROM messages WHERE idx <= ?').run(maxRemoved);
  cleanupFiles(removed);
  pruneReactions();
}

// ---------- 表情回应 ----------

export interface ReactionSummary {
  emoji: string;
  count: number;
  users: string[];
}

/** 单条消息的回应汇总：[{emoji, count, users}] */
export function reactionsFor(idx: number): ReactionSummary[] {
  const rows = open().prepare('SELECT emoji, actor FROM reactions WHERE msg_idx = ? ORDER BY ts ASC').all(idx) as { emoji: string; actor: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji)!.push(r.actor);
  }
  const out: ReactionSummary[] = [];
  map.forEach((users, emoji) => { out.push({ emoji, count: users.length, users }); });
  return out;
}

/** 一次性取出全部回应，按 msg_idx 分组（供 all() 批量附加） */
export function allReactions(): Map<number, ReactionSummary[]> {
  const rows = open().prepare('SELECT msg_idx, emoji, actor FROM reactions ORDER BY ts ASC').all() as { msg_idx: number; emoji: string; actor: string }[];
  const byMsg = new Map<number, Map<string, string[]>>();
  for (const r of rows) {
    if (!byMsg.has(r.msg_idx)) byMsg.set(r.msg_idx, new Map());
    const m = byMsg.get(r.msg_idx)!;
    if (!m.has(r.emoji)) m.set(r.emoji, []);
    m.get(r.emoji)!.push(r.actor);
  }
  const out = new Map<number, ReactionSummary[]>();
  byMsg.forEach((m, idx) => {
    const arr: ReactionSummary[] = [];
    m.forEach((users, emoji) => { arr.push({ emoji, count: users.length, users }); });
    out.set(idx, arr);
  });
  return out;
}

/** 切换回应：同一人再次点击同一表情即取消 */
export function toggleReaction(idx: number, emoji: string, actor: string): { added: boolean; reactions: ReactionSummary[] } {
  const d = open();
  const has = d.prepare('SELECT 1 AS x FROM reactions WHERE msg_idx = ? AND emoji = ? AND actor = ?').get(idx, emoji, actor);
  if (has) {
    d.prepare('DELETE FROM reactions WHERE msg_idx = ? AND emoji = ? AND actor = ?').run(idx, emoji, actor);
  } else {
    d.prepare('INSERT OR REPLACE INTO reactions (msg_idx, emoji, actor, ts) VALUES (?, ?, ?, ?)')
      .run(idx, emoji, actor, Date.now());
  }
  return { added: !has, reactions: reactionsFor(idx) };
}

/** 清理不再对应任何消息的回应 */
function pruneReactions(): void {
  open().prepare('DELETE FROM reactions WHERE msg_idx NOT IN (SELECT idx FROM messages)').run();
}

/** 每个用户累计发送的消息条数（用户资料卡统计用） */
export function countByUser(): Record<string, number> {
  const rows = open().prepare('SELECT "from" AS u, COUNT(*) AS c FROM messages GROUP BY "from"').all() as { u: string; c: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.u] = r.c;
  return out;
}

export function load(): void {
  open();
  migrateFromJson();
}

export interface MsgInput {
  from: string;
  type: string;
  content: string;
  name?: string;
  size?: number;
  gid?: string | null;
  dm?: string | null;
  replyTo?: number;
  md?: number;
}

export interface StoredMessage {
  idx: number;
  id: string;
  from: string;
  type: string;
  content: string;
  ts: number;
  gid?: string | null;
  dm?: string | null;
  recalled?: number;
  recalled_by?: string;
  recalled_at?: number | null;
  name?: string;
  size?: number;
  file_expired?: number;
  reply_to?: number;
  reactions?: ReactionSummary[];
  reply?: { idx: number; from: string; snippet: string };
  md?: number;
}

interface MsgRow {
  idx: number;
  id: string;
  from: string;
  type: string;
  content: string;
  ts: number;
  name: string | null;
  size: number | null;
  recalled: number | null;
  recalled_by: string | null;
  recalled_at: number | null;
  file_expired: number | null;
  reply_to: number | null;
  gid: string | null;
  dm: string | null;
  md: number | null;
}

/**
 * 添加一条消息，返回带 idx 的消息对象
 * @param msg {from, type, content, name?, size?, gid?}
 *        gid 为 null/缺省 表示公共聊天房间；否则为具体群 id
 */
export function add(msg: MsgInput): StoredMessage {
  const d = open();
  const gid = msg.gid != null ? String(msg.gid) : null;
  const dm = msg.dm != null ? String(msg.dm) : null;
  const record: StoredMessage = {
    idx: nextIdx(),
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    from: msg.from,
    type: msg.type,
    content: msg.content,
    ts: Date.now(),
    gid,
    dm
  };
  if (msg.name) record.name = String(msg.name).slice(0, 200);
  if (msg.size) record.size = Number(msg.size);
  if (msg.replyTo) record.reply_to = Number(msg.replyTo);
  if (msg.md != null) record.md = msg.md ? 1 : 0;
  d.prepare('INSERT INTO messages (idx, id, "from", type, content, ts, name, size, reply_to, gid, dm, md) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(record.idx, record.id, String(record.from), String(record.type), String(record.content), record.ts,
      record.name != null ? record.name : null, record.size != null ? record.size : null,
      record.reply_to != null ? record.reply_to : null,
      record.gid != null ? record.gid : null,
      record.dm != null ? record.dm : null,
      record.md != null ? record.md : 0);
  // 按房间裁剪到上限（公共 / 各群 / 各私聊独立保留最近 MAX_MESSAGES 条）
  trimRoom(gid, dm);
  // 广播用的记录也带上引用摘要，其他客户端无需再查一次
  if (record.reply_to != null) {
    const t = get(record.reply_to);
    record.reply = t
      ? { idx: t.idx, from: t.from, snippet: replySnippet(t) }
      : { idx: record.reply_to, from: '', snippet: '原消息已不存在' };
  }
  return record;
}

// 房间匹配谓词：三种房间互斥——
//   公共：gid 为 null 且 dm 为 null；群聊：gid = ? 且 dm 为 null；私聊：dm = ? 且 gid 为 null
function roomClause(gid: string | null, dm: string | null): { clause: string; params: string[] } {
  if (dm != null) return { clause: ' WHERE dm = ? AND gid IS NULL ', params: [String(dm)] };
  if (gid != null) return { clause: ' WHERE gid = ? AND dm IS NULL ', params: [String(gid)] };
  return { clause: ' WHERE gid IS NULL AND dm IS NULL ', params: [] };
}

/** 仅裁剪指定房间超过上限的最旧消息并清理孤立上传文件（公共房间 gid=null） */
function trimRoom(gid: string | null, dm: string | null): void {
  const d = open();
  const { clause, params } = roomClause(gid, dm);
  const cnt = (d.prepare('SELECT COUNT(*) AS c FROM messages' + clause).get(...params) as { c: number }).c;
  if (cnt <= MAX_MESSAGES) return;
  const over = cnt - MAX_MESSAGES;
  const removed = d.prepare('SELECT * FROM messages' + clause + 'ORDER BY idx ASC LIMIT ?').all(...params, over) as unknown as MsgRow[];
  const maxRemoved = removed[removed.length - 1].idx;
  d.prepare('DELETE FROM messages WHERE idx <= ?').run(maxRemoved);
  cleanupFiles(removed);
}

/** 数据库行 -> 消息对象；已撤回 / 已过期的消息不回传原内容 */
function rowToMsg(r: MsgRow): StoredMessage {
  const o: StoredMessage = { idx: r.idx, id: r.id, from: r.from, type: r.type, content: r.content, ts: r.ts };
  if (r.gid != null) o.gid = r.gid;
  if (r.dm != null) o.dm = r.dm;
  if (r.recalled) {
    o.recalled = 1;
    o.recalled_by = r.recalled_by || '';
    o.recalled_at = r.recalled_at || null;
    o.content = '';
    return o;
  }
  if (r.name != null) o.name = r.name;
  if (r.size != null) o.size = r.size;
  if (r.file_expired) {
    // 硬盘文件已被清理：不回传失效地址，前端渲染为「已过期」占位（文件名保留）
    o.file_expired = 1;
    o.content = '';
  }
  if (r.reply_to != null) o.reply_to = r.reply_to;
  if (r.md) o.md = r.md;
  return o;
}

/** 引用摘要：用于回复消息里展示被引用内容的预览 */
function replySnippet(m: StoredMessage): string {
  if (!m) return '原消息已不存在';
  if (m.recalled) return '（已撤回）';
  if (m.file_expired) return m.type === 'image' ? '图片已过期' : '文件已过期';
  if (m.type === 'image') return '[图片]';
  if (m.type === 'video') return '[视频]';
  if (m.type === 'audio') return '[音频]';
  if (m.type === 'file') return '[文件] ' + (m.name || '');
  if (m.type === 'merge') return '[合并转发]';
  const t = String(m.content || '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
}

const SELECT_COLS = 'idx, id, "from", type, content, ts, name, size, recalled, recalled_by, recalled_at, file_expired, reply_to, gid, dm';

/**
 * 获取指定房间的全部消息（按 idx 正序）；gid 为 null 且 dm 为 null 取公共房间；
 * gid 非空取该群；dm 非空取该私聊。
 * 含已撤回 / 已过期的消息，并附上表情回应与引用摘要。
 */
export function all(gid: string | null, dm: string | null): StoredMessage[] {
  const d = open();
  const { clause, params } = roomClause(gid, dm);
  const rows = d.prepare('SELECT ' + SELECT_COLS + ' FROM messages' + clause + 'ORDER BY idx ASC').all(...params) as unknown as MsgRow[];
  const list = rows.map(rowToMsg);

  const rmap = allReactions();
  const byIdx = new Map<number, StoredMessage>();
  for (const m of list) byIdx.set(m.idx, m);

  for (const m of list) {
    const r = rmap.get(m.idx);
    if (r && r.length) m.reactions = r;
    if (m.reply_to != null) {
      const t = byIdx.get(m.reply_to);
      m.reply = t
        ? { idx: t.idx, from: t.from, snippet: replySnippet(t) }
        : { idx: m.reply_to, from: '', snippet: '原消息已不存在' };
    }
  }
  return list;
}

/** 按 idx 取单条消息（撤回前校验归属） */
export function get(idx: number): StoredMessage | null {
  const row = open().prepare('SELECT ' + SELECT_COLS + ' FROM messages WHERE idx = ?').get(idx) as MsgRow | undefined;
  return row ? rowToMsg(row) : null;
}

/**
 * 撤回一条消息（软删除）：保留行并标记撤回人与时间，
 * 使刷新页面后仍能显示「XX 撤回了一条消息」；图片/文件若不再被引用则清理硬盘文件。
 */
export function recall(idx: number, by: string): boolean {
  const d = open();
  const row = d.prepare('SELECT * FROM messages WHERE idx = ?').get(idx) as MsgRow | undefined;
  if (!row || row.recalled) return false;
  d.prepare('UPDATE messages SET recalled = 1, recalled_by = ?, recalled_at = ? WHERE idx = ?')
    .run(by ? String(by) : '', Date.now(), idx);
  d.prepare('DELETE FROM reactions WHERE msg_idx = ?').run(idx); // 撤回后回应一并清除
  cleanupFiles([row]);
  return true;
}

/**
 * 文件过期清理：超过 ttlDays 天的图片 / 文件删除硬盘文件，但**消息记录保留**并
 * 标记 file_expired，聊天列表据此显示「图片/文件已过期」。
 * @param ttlDays 保留天数（默认 15）
 * @returns 本次处理（置为过期）的消息条数
 */
export function cleanupExpired(ttlDays: number): number {
  const d = open();
  const days = Number(ttlDays) > 0 ? Number(ttlDays) : 15;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const rows = d.prepare(
    "SELECT idx, content, type FROM messages WHERE type IN ('image', 'file')" +
    " AND (recalled IS NULL OR recalled = 0) AND (file_expired IS NULL OR file_expired = 0) AND ts < ?"
  ).all(cutoff) as { idx: number; content: string | null; type: string }[];
  if (!rows.length) return 0;

  // 先置为过期：此后它们不再计入 referencedFiles，文件即可安全删除
  const upd = d.prepare('UPDATE messages SET file_expired = 1 WHERE idx = ?');
  d.prepare('BEGIN').run();
  try {
    for (const r of rows) upd.run(r.idx);
    d.prepare('COMMIT').run();
  } catch (e) {
    d.prepare('ROLLBACK').run();
    throw e;
  }

  const keep = referencedFiles();
  for (const r of rows) {
    if (!r.content) continue;
    const base = path.basename(String(r.content));
    if (!base || keep.has(base)) continue;
    const fp = path.join(UPLOAD_DIR, base);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* 忽略 */ }
    dropUpload(base);
  }
  return rows.length;
}

/** 解散群时删除该群的全部消息并清理其引用（或已孤立）的上传文件。公共房间（gid=null）不走此分支 */
export function dissolveMessages(gid: string | null): void {
  if (gid == null) return;
  const d = open();
  const removed = d.prepare('SELECT * FROM messages WHERE gid = ? AND dm IS NULL').all(String(gid)) as unknown as MsgRow[];
  d.prepare('DELETE FROM messages WHERE gid = ? AND dm IS NULL').run(String(gid));
  cleanupFiles(removed);
  // 同步清理该群消息上的表情回应
  for (const r of removed) {
    d.prepare('DELETE FROM reactions WHERE msg_idx = ?').run(r.idx);
  }
}

/**
 * 列出某房间（群 gid 或私聊 dm 传 null 表示公共）内的图片/文件消息，供“群文件管理”展示。
 * 只列未撤回、未过期的文件；按时间倒序。
 */
export function filesByRoom(gid: string | null, dm: string | null): StoredMessage[] {
  const { clause, params } = roomClause(gid, dm);
  const rows = open().prepare(
    'SELECT ' + SELECT_COLS + ' FROM messages' + clause +
    " AND type IN ('image', 'file') AND (recalled IS NULL OR recalled = 0)" +
    " AND (file_expired IS NULL OR file_expired = 0) ORDER BY idx DESC LIMIT 500"
  ).all(...params) as unknown as MsgRow[];
  return rows.map(rowToMsg);
}

/** 硬删除群 gid 内一条图片/文件消息并清理其硬盘文件；非群文件 / 不存在返回 false */
export function removeGroupFile(idx: number, gid: string | null): boolean {
  if (gid == null) return false;
  const d = open();
  const row = d.prepare('SELECT * FROM messages WHERE idx = ? AND gid = ? AND dm IS NULL').get(idx, String(gid)) as MsgRow | undefined;
  if (!row || (row.type !== 'image' && row.type !== 'file')) return false;
  d.prepare('DELETE FROM messages WHERE idx = ?').run(idx);
  d.prepare('DELETE FROM reactions WHERE msg_idx = ?').run(idx);
  cleanupFiles([row]);
  return true;
}

/**
 * 统计每个上传文件当前被引用的消息条数，并附带消息里记录的原始文件名。
 * 已撤回、已过期的消息不再占用文件，因此不计入。
 * @returns Map<文件名, {count, name}>
 */
export function fileUsage(): Map<string, { count: number; name: string }> {
  const rows = open().prepare(
    "SELECT content, name FROM messages WHERE type IN ('image', 'file')" +
    " AND (recalled IS NULL OR recalled = 0) AND (file_expired IS NULL OR file_expired = 0)"
  ).all() as { content: string | null; name: string | null }[];
  const map = new Map<string, { count: number; name: string }>();
  for (const r of rows) {
    if (!r.content) continue;
    const base = path.basename(String(r.content));
    if (!base || base === r.content) continue;
    const cur = map.get(base);
    if (cur) {
      cur.count++;
      if (!cur.name && r.name) cur.name = String(r.name);
    } else {
      map.set(base, { count: 1, name: r.name ? String(r.name) : '' });
    }
  }
  return map;
}

/**
 * 管理员删除上传文件后，把仍引用该文件的消息标记为已过期：
 * 前端据此显示「图片/文件已过期」占位，避免聊天记录里留下打不开的坏链。
 * @param base 上传目录内的文件名
 * @returns 本次被标记为过期的消息条数
 */
export function expireByFile(base: string): number {
  const info = open().prepare(
    "UPDATE messages SET file_expired = 1 WHERE type IN ('image', 'file')" +
    " AND (recalled IS NULL OR recalled = 0) AND (file_expired IS NULL OR file_expired = 0)" +
    " AND content LIKE ?"
  ).run('%/' + String(base));
  return info && info.changes ? Number(info.changes) : 0;
}

// ---------- 上传文件去重（同一份内容只落盘一次） ----------

/**
 * 按内容 hash 查已落盘的文件名；没有返回 null。
 * 调用方仍需确认文件确实存在（可能被管理员删除或已过期清理）。
 */
export function findUploadBySha(sha: string): string | null {
  const row = open().prepare('SELECT name FROM uploads WHERE sha = ?').get(String(sha)) as { name: string } | undefined;
  return row ? String(row.name) : null;
}

/** 记录一次落盘，供后续上传去重命中 */
export function putUpload(sha: string, name: string, size: number): void {
  open().prepare('INSERT OR REPLACE INTO uploads (sha, name, size, ts) VALUES (?, ?, ?, ?)')
    .run(String(sha), String(name), Number(size) || 0, Date.now());
}

/** 物理文件被删除后移除去重记录（按落盘名） */
export function dropUpload(name: string): void {
  open().prepare('DELETE FROM uploads WHERE name = ?').run(String(name));
}

export { MAX_MESSAGES, DB_FILE, DB_FILE as MSGS_FILE };
