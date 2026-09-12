'use strict';
/* ============================================================
 * ChatPlus 私人聊天服务器 — 群组管理模块
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * 功能：群组创建 / 解散 / 重命名、成员加入 / 退出 / 查询。
 * 权限模型：群所有者（owner）可管理本人群；全局 admin 可管理任意群；
 *           普通成员可加入 / 退出。不引入成员分级角色。
 * 数据：持久化到 data/chatplus.db（SQLite，使用 Node 内置 node:sqlite）。
 * ============================================================ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'chatplus.db');

let db = null;

function open() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  return db;
}

/** 生成唯一群 id：16 位十六进制文本 */
function newGid() {
  return crypto.randomBytes(8).toString('hex');
}

/** 创建一个群，并把创建者写入成员表 */
function createGroup(name, owner) {
  const d = open();
  const id = newGid();
  const now = Date.now();
  d.prepare('INSERT INTO groups (id, name, owner, created, updated) VALUES (?, ?, ?, ?, ?)')
    .run(id, String(name), String(owner), now, now);
  d.prepare('INSERT OR IGNORE INTO group_members (gid, name, joined) VALUES (?, ?, ?)')
    .run(id, String(owner), now);
  return { id, name: String(name), owner: String(owner), created: now };
}

/** 该用户加入的所有群 */
function listGroupsOf(name) {
  const d = open();
  const rows = d.prepare(
    'SELECT g.id, g.name, g.owner, g.created FROM group_members gm ' +
    'JOIN groups g ON g.id = gm.gid WHERE gm.name = ? ORDER BY g.created ASC'
  ).all(String(name));
  return rows.map(function (r) {
    const o = { id: r.id, name: r.name, owner: r.owner };
    if (r.created != null) o.created = r.created;
    return o;
  });
}

/** 按 id 取群信息 */
function getGroup(id) {
  const r = open().prepare('SELECT id, name, owner, created, updated FROM groups WHERE id = ?').get(String(id));
  return r || null;
}

/** 群成员列表 */
function groupMembers(id) {
  const rows = open().prepare('SELECT name, joined FROM group_members WHERE gid = ? ORDER BY joined ASC').all(String(id));
  return rows.map(function (r) {
    const o = { name: r.name };
    if (r.joined != null) o.joined = r.joined;
    return o;
  });
}

/** 是否成员 */
function isMember(id, name) {
  if (!id || !name) return false;
  const r = open().prepare('SELECT 1 AS x FROM group_members WHERE gid = ? AND name = ?')
    .get(String(id), String(name));
  return !!r;
}

/** 是否群主 */
function isOwner(id, name) {
  if (!id || !name) return false;
  const r = open().prepare('SELECT 1 AS x FROM groups WHERE id = ? AND owner = ?')
    .get(String(id), String(name));
  return !!r;
}

/** 新增成员；群不存在返回 false */
function addMember(id, name) {
  const d = open();
  const g = d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(String(id));
  if (!g) return false;
  d.prepare('INSERT OR IGNORE INTO group_members (gid, name, joined) VALUES (?, ?, ?)')
    .run(String(id), String(name), Date.now());
  return true;
}

/** 移除成员；群主不可退群（需先转让或解散）；群不存在或非成员返回 false */
function removeMember(id, name) {
  const d = open();
  const owner = d.prepare('SELECT owner FROM groups WHERE id = ?').get(String(id));
  if (!owner) return false;
  if (owner.owner === String(name)) return false; // 群主不可退群
  const r = d.prepare('DELETE FROM group_members WHERE gid = ? AND name = ?').run(String(id), String(name));
  return !!(r && r.changes > 0);
}

/** 重命名群 */
function renameGroup(id, name) {
  const d = open();
  const g = d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(String(id));
  if (!g) return false;
  d.prepare('UPDATE groups SET name = ?, updated = ? WHERE id = ?').run(String(name), Date.now(), String(id));
  return true;
}

/** 解散群：删除群信息与全部成员关系 */
function dissolveGroup(id) {
  const d = open();
  const r = d.prepare('DELETE FROM groups WHERE id = ?').run(String(id));
  if (!r || r.changes === 0) return false;
  d.prepare('DELETE FROM group_members WHERE gid = ?').run(String(id));
  return true;
}

/** 用户被删除时清理其全部成员关系（避免成员表遗留孤儿） */
function removeUserAll(name) {
  open().prepare('DELETE FROM group_members WHERE name = ?').run(String(name));
}

module.exports = {
  createGroup,
  listGroupsOf,
  getGroup,
  groupMembers,
  isMember,
  isOwner,
  addMember,
  removeMember,
  renameGroup,
  dissolveGroup,
  removeUserAll
};