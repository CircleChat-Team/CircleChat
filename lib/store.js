'use strict';
/* ============================================================
 * CircleChat 私人聊天服务器 — 消息存储模块（仅保留最近 N 条）
 * [WM: 本模块为关键存储模块，请勿改动，改动将导致完整性校验失败]
 * 消息持久化到 data/chatplus.db（SQLite，使用 Node 内置 node:sqlite），
 * 超过上限自动裁剪，并同步清理不再被引用的上传文件。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'chatplus.db');
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

const MAX_MESSAGES = 500; // 仅保留最近 500 条

let db = null;

function open() {
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
      dm           TEXT
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
  `);
  return db;
}

function nextIdx() {
  const row = open().prepare('SELECT COALESCE(MAX(idx), 0) AS m FROM messages').get();
  return (row && row.m ? row.m : 0) + 1;
}

// 从已有 messages.json 迁移（仅首次、表为空时）
function migrateFromJson() {
  const d = open();
  if (d.prepare('SELECT COUNT(*) AS c FROM messages').get().c > 0) return;
  const jsonPath = path.join(DATA_DIR, 'messages.json');
  if (!fs.existsSync(jsonPath)) return;
  let arr;
  try { arr = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { return; }
  if (!Array.isArray(arr) || !arr.length) return;
  arr.sort((a, b) => (Number(a.idx) || Number(a.ts) || 0) - (Number(b.idx) || Number(b.ts) || 0));
  const ins = d.prepare('INSERT INTO messages (idx, id, "from", type, content, ts, name, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  d.prepare('BEGIN').run();
  try {
    for (const m of arr) {
      ins.run(
        Number(m.idx) || nextIdx(),
        String(m.id || (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8))),
        String(m.from || ''),
        String(m.type || 'text'),
        String(m.content || ''),
        Number(m.ts) || Date.now(),
        m.name != null ? String(m.name) : null,
        m.size != null ? Number(m.size) : null
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
function referencedFiles() {
  const set = new Set();
  const rows = open().prepare(
    "SELECT content, type FROM messages WHERE type IN ('image', 'file')" +
    " AND (recalled IS NULL OR recalled = 0) AND (file_expired IS NULL OR file_expired = 0)"
  ).all();
  for (const r of rows) {
    if (!r.content) continue;
    const base = path.basename(String(r.content));
    if (base && base !== r.content) set.add(base);
  }
  return set;
}

/** 删除不再被引用且属于本服务器上传目录的文件 */
function cleanupFiles(removedRows) {
  const keep = referencedFiles();
  for (const m of removedRows) {
    if ((m.type === 'image' || m.type === 'file') && m.content) {
      const base = path.basename(String(m.content));
      if (keep.has(base)) continue;
      const fp = path.join(UPLOAD_DIR, base);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* 忽略 */ }
    }
  }
}

/** 超出上限时，删除最旧的若干条并清理孤立文件 */
function trim() {
  const d = open();
  const cnt = d.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  if (cnt <= MAX_MESSAGES) return;
  const over = cnt - MAX_MESSAGES;
  const removed = d.prepare('SELECT * FROM messages ORDER BY idx ASC LIMIT ?').all(over);
  const maxRemoved = removed[removed.length - 1].idx;
  d.prepare('DELETE FROM messages WHERE idx <= ?').run(maxRemoved);
  cleanupFiles(removed);
  pruneReactions();
}

// ---------- 表情回应 ----------

/** 单条消息的回应汇总：[{emoji, count, users}] */
function reactionsFor(idx) {
  const rows = open().prepare('SELECT emoji, actor FROM reactions WHERE msg_idx = ? ORDER BY ts ASC').all(idx);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.emoji)) map.set(r.emoji, []);
    map.get(r.emoji).push(r.actor);
  }
  const out = [];
  map.forEach(function (users, emoji) { out.push({ emoji: emoji, count: users.length, users: users }); });
  return out;
}

/** 一次性取出全部回应，按 msg_idx 分组（供 all() 批量附加） */
function allReactions() {
  const rows = open().prepare('SELECT msg_idx, emoji, actor FROM reactions ORDER BY ts ASC').all();
  const byMsg = new Map();
  for (const r of rows) {
    if (!byMsg.has(r.msg_idx)) byMsg.set(r.msg_idx, new Map());
    const m = byMsg.get(r.msg_idx);
    if (!m.has(r.emoji)) m.set(r.emoji, []);
    m.get(r.emoji).push(r.actor);
  }
  const out = new Map();
  byMsg.forEach(function (m, idx) {
    const arr = [];
    m.forEach(function (users, emoji) { arr.push({ emoji: emoji, count: users.length, users: users }); });
    out.set(idx, arr);
  });
  return out;
}

/** 切换回应：同一人再次点击同一表情即取消 */
function toggleReaction(idx, emoji, actor) {
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
function pruneReactions() {
  open().prepare('DELETE FROM reactions WHERE msg_idx NOT IN (SELECT idx FROM messages)').run();
}

/** 每个用户累计发送的消息条数（用户资料卡统计用） */
function countByUser() {
  const rows = open().prepare('SELECT "from" AS u, COUNT(*) AS c FROM messages GROUP BY "from"').all();
  const out = {};
  for (const r of rows) out[r.u] = r.c;
  return out;
}

function load() {
  open();
  migrateFromJson();
}

/**
 * 添加一条消息，返回带 idx 的消息对象
 * @param {Object} msg {from, type, content, name?, size?, gid?}
 *        gid 为 null/缺省 表示公共聊天房间；否则为具体群 id
 */
function add(msg) {
  const d = open();
  const gid = msg.gid != null ? String(msg.gid) : null;
  const dm = msg.dm != null ? String(msg.dm) : null;
  const record = {
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
  d.prepare('INSERT INTO messages (idx, id, "from", type, content, ts, name, size, reply_to, gid, dm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(record.idx, record.id, String(record.from), String(record.type), String(record.content), record.ts,
         record.name != null ? record.name : null, record.size != null ? record.size : null,
         record.reply_to != null ? record.reply_to : null,
         record.gid != null ? record.gid : null,
         record.dm != null ? record.dm : null);
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
function roomClause(gid, dm) {
  if (dm != null) return { clause: ' WHERE dm = ? AND gid IS NULL ', params: [String(dm)] };
  if (gid != null) return { clause: ' WHERE gid = ? AND dm IS NULL ', params: [String(gid)] };
  return { clause: ' WHERE gid IS NULL AND dm IS NULL ', params: [] };
}

/** 仅裁剪指定房间超过上限的最旧消息并清理孤立上传文件（公共房间 gid=null） */
function trimRoom(gid, dm) {
  const d = open();
  const { clause, params } = roomClause(gid, dm);
  const cnt = d.prepare('SELECT COUNT(*) AS c FROM messages' + clause).get(...params).c;
  if (cnt <= MAX_MESSAGES) return;
  const over = cnt - MAX_MESSAGES;
  const removed = d.prepare('SELECT * FROM messages' + clause + 'ORDER BY idx ASC LIMIT ?').all(...params, over);
  const maxRemoved = removed[removed.length - 1].idx;
  d.prepare('DELETE FROM messages WHERE idx <= ?').run(maxRemoved);
  cleanupFiles(removed);
}

/** 数据库行 -> 消息对象；已撤回 / 已过期的消息不回传原内容 */
function rowToMsg(r) {
  if (!r) return null;
  const o = { idx: r.idx, id: r.id, from: r.from, type: r.type, content: r.content, ts: r.ts };
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
  return o;
}

/** 引用摘要：用于回复消息里展示被引用内容的预览 */
function replySnippet(m) {
  if (!m) return '原消息已不存在';
  if (m.recalled) return '（已撤回）';
  if (m.file_expired) return m.type === 'image' ? '图片已过期' : '文件已过期';
  if (m.type === 'image') return '[图片]';
  if (m.type === 'file') return '[文件] ' + (m.name || '');
  const t = String(m.content || '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
}

const SELECT_COLS = 'idx, id, "from", type, content, ts, name, size, recalled, recalled_by, recalled_at, file_expired, reply_to, gid, dm';

/**
 * 获取指定房间的全部消息（按 idx 正序）；gid 为 null 且 dm 为 null 取公共房间；
 * gid 非空取该群；dm 非空取该私聊。
 * 含已撤回 / 已过期的消息，并附上表情回应与引用摘要。
 */
function all(gid, dm) {
  const d = open();
  const { clause, params } = roomClause(gid, dm);
  const rows = d.prepare('SELECT ' + SELECT_COLS + ' FROM messages' + clause + 'ORDER BY idx ASC').all(...params);
  const list = rows.map(rowToMsg);

  const rmap = allReactions();
  const byIdx = new Map();
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
function get(idx) {
  const row = open().prepare('SELECT ' + SELECT_COLS + ' FROM messages WHERE idx = ?').get(idx);
  return rowToMsg(row);
}

/**
 * 撤回一条消息（软删除）：保留行并标记撤回人与时间，
 * 使刷新页面后仍能显示「XX 撤回了一条消息」；图片/文件若不再被引用则清理硬盘文件。
 */
function recall(idx, by) {
  const d = open();
  const row = d.prepare('SELECT * FROM messages WHERE idx = ?').get(idx);
  if (!row || row.recalled) return false;
  d.prepare('UPDATE messages SET recalled = 1, recalled_by = ?, recalled_at = ? WHERE idx = ?')
    .run(by ? String(by) : '', Date.now(), idx);
  d.prepare('DELETE FROM reactions WHERE msg_idx = ?').run(idx); // 撤回后回应一并清除
  cleanupFiles([row]);
  return true;
}

/**
 * 文件过期清理：超过 ttlDays 天的图片 / 文件删除硬盘文件，但**消息记录保留**并
 * 标记 file_expired，聊天列表据此显示「图片已过期 / 文件已过期」。
 * @param {number} ttlDays 保留天数（默认 15）
 * @returns {number} 本次处理（置为过期）的消息条数
 */
function cleanupExpired(ttlDays) {
  const d = open();
  const days = Number(ttlDays) > 0 ? Number(ttlDays) : 15;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const rows = d.prepare(
    "SELECT idx, content, type FROM messages WHERE type IN ('image', 'file')" +
    " AND (recalled IS NULL OR recalled = 0) AND (file_expired IS NULL OR file_expired = 0) AND ts < ?"
  ).all(cutoff);
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
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* 忽略 */ }
  }
  return rows.length;
}

/** 解散群时删除该群的全部消息并清理其引用（或已孤立）的上传文件。公共房间（gid=null）不走此分支 */
function dissolveMessages(gid) {
  if (gid == null) return;
  const d = open();
  const removed = d.prepare('SELECT * FROM messages WHERE gid = ? AND dm IS NULL').all(String(gid));
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
function filesByRoom(gid, dm) {
  const { clause, params } = roomClause(gid, dm);
  const rows = open().prepare(
    'SELECT ' + SELECT_COLS + ' FROM messages' + clause +
    " AND type IN ('image', 'file') AND (recalled IS NULL OR recalled = 0)" +
    " AND (file_expired IS NULL OR file_expired = 0) ORDER BY idx DESC LIMIT 500"
  ).all(...params);
  return rows.map(rowToMsg);
}

/** 硬删除群 gid 内一条图片/文件消息并清理其硬盘文件；非群文件 / 不存在返回 false */
function removeGroupFile(idx, gid) {
  if (gid == null) return false;
  const d = open();
  const row = d.prepare('SELECT * FROM messages WHERE idx = ? AND gid = ? AND dm IS NULL').get(idx, String(gid));
  if (!row || (row.type !== 'image' && row.type !== 'file')) return false;
  d.prepare('DELETE FROM messages WHERE idx = ?').run(idx);
  d.prepare('DELETE FROM reactions WHERE msg_idx = ?').run(idx);
  cleanupFiles([row]);
  return true;
}

/**
 * 统计每个上传文件当前被引用的消息条数，并附带消息里记录的原始文件名。
 * 已撤回、已过期的消息不再占用文件，因此不计入。
 * @returns {Map<string, {count: number, name: string}>} key 为上传目录内的文件名
 */
function fileUsage() {
  const rows = open().prepare(
    "SELECT content, name FROM messages WHERE type IN ('image', 'file')" +
    " AND (recalled IS NULL OR recalled = 0) AND (file_expired IS NULL OR file_expired = 0)"
  ).all();
  const map = new Map();
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
 * @param {string} base 上传目录内的文件名
 * @returns {number} 本次被标记为过期的消息条数
 */
function expireByFile(base) {
  const d = open();
  const info = d.prepare(
    "UPDATE messages SET file_expired = 1 WHERE type IN ('image', 'file')" +
    " AND (recalled IS NULL OR recalled = 0) AND (file_expired IS NULL OR file_expired = 0)" +
    " AND content LIKE ?"
  ).run('%/' + String(base));
  return info && info.changes ? info.changes : 0;
}

module.exports = { load, add, all, get, recall, cleanupExpired, toggleReaction, countByUser, dissolveMessages, filesByRoom, removeGroupFile, fileUsage, expireByFile, MAX_MESSAGES, DB_FILE, MSGS_FILE: DB_FILE };

