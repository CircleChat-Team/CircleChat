'use strict';
/* ============================================================
 * ChatPlus 私人聊天服务器 — 消息存储模块（仅保留最近 N 条）
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * [WM: 本模块为关键存储模块，请勿改动，改动将导致完整性校验失败]
 * 消息持久化到 data/messages.json，超过上限自动裁剪，
 * 并同步清理不再被引用的上传文件。
 * ============================================================ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MSGS_FILE = path.join(DATA_DIR, 'messages.json');
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

const MAX_MESSAGES = 500; // 仅保留最近 500 条

let messages = [];
let seq = 0;

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(MSGS_FILE, 'utf8'));
    if (Array.isArray(data)) {
      messages = data.slice(-MAX_MESSAGES);
      for (const m of messages) {
        const n = Number(m.idx) || 0;
        if (n > seq) seq = n;
      }
      return;
    }
  } catch (e) { /* 文件缺失或损坏则从空开始 */ }
  messages = [];
}

/** 原子写入（先写临时文件再改名，避免写一半损坏） */
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = MSGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(messages, null, 2), 'utf8');
  fs.renameSync(tmp, MSGS_FILE);
}

/** 收集消息中引用的上传文件名集合 */
function referencedFiles() {
  const set = new Set();
  for (const m of messages) {
    if ((m.type === 'image' || m.type === 'file') && m.content) {
      const base = path.basename(String(m.content));
      if (base && base !== m.content) set.add(base);
    }
  }
  return set;
}

/** 删除不再被引用且属于本服务器上传目录的文件 */
function cleanupFiles(removedMsgs) {
  const keep = referencedFiles();
  for (const m of removedMsgs) {
    if ((m.type === 'image' || m.type === 'file') && m.content) {
      const base = path.basename(String(m.content));
      if (keep.has(base)) continue;
      const fp = path.join(UPLOAD_DIR, base);
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch (e) { /* 忽略 */ }
    }
  }
}

/**
 * 添加一条消息，返回带 id 的消息对象
 * @param {Object} msg {from, type, content, name?, size?}
 */
function add(msg) {
  seq += 1;
  const record = {
    idx: seq,
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    from: msg.from,
    type: msg.type,
    content: msg.content,
    ts: Date.now()
  };
  if (msg.name) record.name = String(msg.name).slice(0, 200);
  if (msg.size) record.size = Number(msg.size);
  messages.push(record);
  if (messages.length > MAX_MESSAGES) {
    const removed = messages.splice(0, messages.length - MAX_MESSAGES);
    cleanupFiles(removed);
  }
  save();
  return record;
}

/** 获取全部（按时间正序） */
function all() {
  return messages.slice();
}

module.exports = { load, add, all, MAX_MESSAGES, MSGS_FILE };
