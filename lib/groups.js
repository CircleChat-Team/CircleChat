'use strict';
/* ============================================================
 * CircleChat 私人聊天服务器 — 群组管理模块
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

/** 生成唯一群 id：6-10 位随机数字+大小写字母 */
const GID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function newGid() {
  const d = open();
  const len = 6 + Math.floor(Math.random() * 5); // 6..10
  for (;;) {
    let s = '';
    for (let i = 0; i < len; i++) s += GID_CHARS[Math.floor(Math.random() * GID_CHARS.length)];
    if (!d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(s)) return s;
  }
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
    'SELECT g.id, g.name, g.owner, g.created, g.avatar FROM group_members gm ' +
    'JOIN groups g ON g.id = gm.gid WHERE gm.name = ? ORDER BY g.created ASC'
  ).all(String(name));
  return rows.map(function (r) {
    const o = { id: r.id, name: r.name, owner: r.owner, avatar: r.avatar || null };
    if (r.created != null) o.created = r.created;
    return o;
  });
}

/** 按 id 取群信息 */
function getGroup(id) {
  const r = open().prepare('SELECT id, name, owner, created, updated, avatar FROM groups WHERE id = ?').get(String(id));
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

// ---------- 入群申请与审核（申请 → 群主/管理员审核） ----------

const REQ_PENDING = 'pending';
const REQ_APPROVED = 'approved';
const REQ_REJECTED = 'rejected';

/** 按群名模糊 / 群ID精确搜索可见群（供“按名称或群ID加群”使用，名匹配最多 20 个） */
function searchGroups(keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  const d = open();
  const toRow = (r) => {
    const o = { id: r.id, name: r.name, owner: r.owner, avatar: r.avatar || null };
    if (r.created != null) o.created = r.created;
    return o;
  };
  // 优先精确匹配群ID（支持直接输入群ID加入）
  const exact = d.prepare('SELECT id, name, owner, created, avatar FROM groups WHERE id = ? LIMIT 1').get(kw);
  const like = '%' + kw + '%';
  const rows = d.prepare('SELECT id, name, owner, created, avatar FROM groups WHERE name LIKE ? ORDER BY created ASC LIMIT 20').all(like);
  const out = [];
  if (exact) out.push(toRow(exact));
  for (const r of rows) {
    if (!exact || r.id !== exact.id) out.push(toRow(r));
  }
  return out;
}

/** 列出全部群（仅管理员接口使用） */
function listAllGroups() {
  return open().prepare('SELECT id, name, owner, created, avatar FROM groups ORDER BY created ASC').all()
    .map((r) => {
      const o = { id: r.id, name: r.name, owner: r.owner, avatar: r.avatar || null };
      if (r.created != null) o.created = r.created;
      return o;
    });
}

/**
 * 提交入群申请。返回 { ok, reason? }
 * 群不存在 / 已是成员 / 已有待处理申请 时不接受。
 */
function requestJoin(gid, name) {
  const d = open();
  gid = String(gid); name = String(name);
  const g = d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(gid);
  if (!g) return { ok: false, reason: '群不存在' };
  if (d.prepare('SELECT 1 AS x FROM group_members WHERE gid = ? AND name = ?').get(gid, name)) {
    return { ok: false, reason: '你已经是该群成员' };
  }
  const dup = d.prepare("SELECT 1 AS x FROM join_requests WHERE gid = ? AND name = ? AND status = ?")
    .get(gid, name, REQ_PENDING);
  if (dup) return { ok: false, reason: '申请已发送，等待群主审核' };
  const rej = d.prepare("SELECT 1 AS x FROM join_requests WHERE gid = ? AND name = ? AND status = ?")
    .get(gid, name, REQ_REJECTED);
  if (rej) return { ok: false, reason: '你曾被拒绝入群，请联系群主' };
  d.prepare('INSERT INTO join_requests (gid, name, created, status) VALUES (?, ?, ?, ?)')
    .run(gid, name, Date.now(), REQ_PENDING);
  return { ok: true };
}

/** 某群的全部待审核入群申请（按时间正序） */
function pendingRequests(gid) {
  return open().prepare('SELECT id, name, created FROM join_requests WHERE gid = ? AND status = ? ORDER BY created ASC')
    .all(String(gid), REQ_PENDING)
    .map((r) => {
      const o = { id: r.id, name: r.name };
      if (r.created != null) o.created = r.created;
      return o;
    });
}

/** 审核通过入群申请：标记 approved 并把申请人加入成员表；用户不存在 / 已处理返回 false */
function approveJoin(gid, name) {
  const d = open();
  gid = String(gid); name = String(name);
  const r = d.prepare("SELECT id FROM join_requests WHERE gid = ? AND name = ? AND status = ?")
    .get(gid, name, REQ_PENDING);
  if (!r) return false;
  d.prepare('UPDATE join_requests SET status = ? WHERE id = ?').run(REQ_APPROVED, r.id);
  d.prepare('INSERT OR IGNORE INTO group_members (gid, name, joined) VALUES (?, ?, ?)')
    .run(gid, name, Date.now());
  return true;
}

/** 拒绝入群申请：标记 rejected；不存在 / 已处理返回 false */
function rejectJoin(gid, name) {
  const d = open();
  gid = String(gid); name = String(name);
  const r = d.prepare("SELECT id FROM join_requests WHERE gid = ? AND name = ? AND status = ?")
    .get(gid, name, REQ_PENDING);
  if (!r) return false;
  d.prepare('UPDATE join_requests SET status = ? WHERE id = ?').run(REQ_REJECTED, r.id);
  return true;
}

/** 解散群时清理该群全部入群申请 */
function removeRequestsOfGroup(gid) {
  open().prepare('DELETE FROM join_requests WHERE gid = ?').run(String(gid));
}

/** 用户被删除时清理其全部入群申请 */
function removeRequestsOfUser(name) {
  open().prepare('DELETE FROM join_requests WHERE name = ?').run(String(name));
}

/** 转移群主：新群主必须是成员；群主须在指定群内 */
function transferOwner(gid, oldOwner, newOwner) {
  const d = open();
  gid = String(gid); oldOwner = String(oldOwner); newOwner = String(newOwner);
  const g = d.prepare('SELECT owner FROM groups WHERE id = ?').get(gid);
  if (!g) return false;
  if (g.owner !== oldOwner) return false; // 仅当前群主可发起转移
  if (!d.prepare('SELECT 1 AS x FROM group_members WHERE gid = ? AND name = ?').get(gid, newOwner)) {
    return false; // 新群主必须是群成员
  }
  d.prepare('UPDATE groups SET owner = ?, updated = ? WHERE id = ?').run(newOwner, Date.now(), gid);
  return true;
}

/** 列出某群全部成员（含是否为群主），供管理面板展示 */
function manageMembers(id) {
  const owner = open().prepare('SELECT owner FROM groups WHERE id = ?').get(String(id));
  const ownerName = owner ? owner.owner : '';
  return groupMembers(id).map((m) => ({
    name: m.name,
    owner: m.name === ownerName,
    joined: m.joined != null ? m.joined : null
  }));
}

/** 设置群头像：avatar 传空串/空表示清除；权限判定由调用方负责 */
function setGroupAvatar(gid, avatar) {
  const d = open();
  gid = String(gid);
  if (!d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(gid)) return { ok: false, code: 'api.group.notFound' };
  const v = avatar == null ? '' : String(avatar).trim().slice(0, 1024);
  // 仅允许 http(s) 图片地址或清空
  if (v && !/^https?:\/\//i.test(v)) return { ok: false, code: 'group.avatarInvalid' };
  d.prepare('UPDATE groups SET avatar = ?, updated = ? WHERE id = ?').run(v || null, Date.now(), gid);
  return { ok: true, avatar: v || null };
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
  removeUserAll,
  searchGroups,
  listAllGroups,
  requestJoin,
  pendingRequests,
  approveJoin,
  rejectJoin,
  removeRequestsOfGroup,
  removeRequestsOfUser,
  transferOwner,
  manageMembers,
  setGroupAvatar
};