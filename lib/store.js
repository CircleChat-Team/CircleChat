'use strict';
/* ============================================================
 * ChatPlus 私人聊天服务器 — 消息存储模块（仅保留最近 N 条）
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
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
      file_expired INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_messages_idx ON messages(idx);
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
}

function load() {
  open();
  migrateFromJson();
}

/**
 * 添加一条消息，返回带 idx 的消息对象
 * @param {Object} msg {from, type, content, name?, size?}
 */
function add(msg) {
  const d = open();
  const record = {
    idx: nextIdx(),
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    from: msg.from,
    type: msg.type,
    content: msg.content,
    ts: Date.now()
  };
  if (msg.name) record.name = String(msg.name).slice(0, 200);
  if (msg.size) record.size = Number(msg.size);
  d.prepare('INSERT INTO messages (idx, id, "from", type, content, ts, name, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(record.idx, record.id, String(record.from), String(record.type), String(record.content), record.ts,
         record.name != null ? record.name : null, record.size != null ? record.size : null);
  // 裁剪到上限
  const cnt = d.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  if (cnt > MAX_MESSAGES) {
    const over = cnt - MAX_MESSAGES;
    const removed = d.prepare('SELECT * FROM messages ORDER BY idx ASC LIMIT ?').all(over);
    d.prepare('DELETE FROM messages WHERE idx <= ?').run(removed[removed.length - 1].idx);
    cleanupFiles(removed);
  }
  return record;
}

/** 数据库行 -> 消息对象；已撤回 / 已过期的消息不回传原内容 */
function rowToMsg(r) {
  if (!r) return null;
  const o = { idx: r.idx, id: r.id, from: r.from, type: r.type, content: r.content, ts: r.ts };
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
  return o;
}

const SELECT_COLS = 'idx, id, "from", type, content, ts, name, size, recalled, recalled_by, recalled_at, file_expired';

/** 获取全部（按 idx 正序）；含已撤回 / 已过期的消息，由前端渲染为对应提示 */
function all() {
  const rows = open().prepare('SELECT ' + SELECT_COLS + ' FROM messages ORDER BY idx ASC').all();
  return rows.map(rowToMsg);
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

module.exports = { load, add, all, get, recall, cleanupExpired, MAX_MESSAGES, DB_FILE, MSGS_FILE: DB_FILE };
