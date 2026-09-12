'use strict';
/* ============================================================
 * ChatPlus 私人聊天服务器 — 审计日志模块
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * [WM: 本模块为关键审计模块，请勿改动，改动将导致完整性校验失败]
 *
 * 记录用户的关键操作（登录、退出、发消息、撤回、上传、管理操作等），
 * 持久化到 data/chatplus.db 的 audit_logs 表。
 * 仅管理员可通过 GET /api/admin/logs 查看；超出上限自动裁剪最旧记录。
 * 任何写入失败都不会影响主流程。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'chatplus.db');

const MAX_LOGS = 5000;   // 仅保留最近 5000 条
const MAX_DETAIL = 300;  // 单条详情长度上限

let db = null;

function open() {
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

function load() { open(); }

/** 超出上限时裁剪最旧的记录 */
function trim() {
  const d = open();
  const c = d.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c;
  if (c <= MAX_LOGS) return;
  d.prepare('DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs ORDER BY id ASC LIMIT ?)').run(c - MAX_LOGS);
}

/**
 * 写入一条审计记录（同步、容错，失败不影响业务）
 * @param {Object} e { actor, action, target?, detail?, ip? }
 */
function add(e) {
  try {
    if (!e || !e.action) return;
    open().prepare('INSERT INTO audit_logs (ts, actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        Date.now(),
        String(e.actor || ''),
        String(e.action),
        e.target != null ? String(e.target).slice(0, 60) : null,
        e.detail != null ? String(e.detail).slice(0, MAX_DETAIL) : null,
        e.ip != null ? String(e.ip) : null
      );
    trim();
  } catch (err) {
    // 审计写入失败不能影响主流程
  }
}

/**
 * 查询日志（按时间倒序，最新在前）
 * @param {Object} opt { limit?, offset?, actor?, action? }
 * @returns {{ total:number, logs:Array }}
 */
function list(opt) {
  const o = opt || {};
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(o.offset, 10) || 0, 0);

  const where = [];
  const args = [];
  if (o.actor) { where.push('actor LIKE ?'); args.push('%' + String(o.actor).slice(0, 40) + '%'); }
  if (o.action) { where.push('action = ?'); args.push(String(o.action).slice(0, 40)); }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const d = open();
  const total = d.prepare('SELECT COUNT(*) AS c FROM audit_logs' + whereSql).get(...args).c;
  const logs = d.prepare(
    'SELECT id, ts, actor, action, target, detail, ip FROM audit_logs' + whereSql +
    ' ORDER BY id DESC LIMIT ? OFFSET ?'
  ).all(...args, limit, offset);
  return { total, logs };
}

module.exports = { load, add, list, MAX_LOGS, DB_FILE };
