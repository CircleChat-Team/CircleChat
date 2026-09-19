// CircleChat — 群组管理模块（Nitro 版，对应 lib/groups.js）
// 群组创建 / 解散 / 重命名、成员加入 / 退出 / 查询、入群申请与审核。
// 权限模型：群所有者（owner）可管理本人群；全局 admin 可管理任意群；普通成员可加入 / 退出。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 路径锚定到运行根目录（package.json 启动目录 = 项目根）
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'chatplus.db');

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  return db;
}

/** 生成唯一群 id：16 位十六进制文本 */
function newGid(): string {
  return crypto.randomBytes(8).toString('hex');
}

export interface GroupInfo {
  id: string;
  name: string;
  owner: string;
  created?: number;
  avatar?: string | null;
  announcement?: string | null;
}

export interface GroupMember {
  name: string;
  owner?: boolean;
  joined?: number | null;
}

/** 创建一个群，并把创建者写入成员表 */
export function createGroup(name: string, owner: string): GroupInfo {
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
export function listGroupsOf(name: string): GroupInfo[] {
  const d = open();
  const rows = d.prepare(
    'SELECT g.id, g.name, g.owner, g.created, g.avatar, g.announcement FROM group_members gm ' +
    'JOIN groups g ON g.id = gm.gid WHERE gm.name = ? ORDER BY g.created ASC'
  ).all(String(name)) as { id: string; name: string; owner: string; created: number | null; avatar: string | null; announcement: string | null }[];
  return rows.map((r) => {
    const o: GroupInfo = { id: r.id, name: r.name, owner: r.owner };
    if (r.created != null) o.created = r.created;
    if (r.avatar != null) o.avatar = r.avatar;
    if (r.announcement != null) o.announcement = r.announcement;
    return o;
  });
}

/** 按 id 取群信息 */
export function getGroup(id: string): GroupInfo | null {
  const r = open().prepare('SELECT id, name, owner, created, updated, avatar, announcement FROM groups WHERE id = ?').get(String(id)) as
    | (GroupInfo & { created: number | null })
    | undefined;
  return r || null;
}

/** 群成员列表 */
export function groupMembers(id: string): GroupMember[] {
  const rows = open().prepare('SELECT name, joined FROM group_members WHERE gid = ? ORDER BY joined ASC').all(String(id)) as
    | { name: string; joined: number | null }[]
    | undefined;
  const list = rows || [];
  return list.map((r) => {
    const o: GroupMember = { name: r.name };
    if (r.joined != null) o.joined = r.joined;
    return o;
  });
}

/** 是否成员 */
export function isMember(id: string, name: string): boolean {
  if (!id || !name) return false;
  const r = open().prepare('SELECT 1 AS x FROM group_members WHERE gid = ? AND name = ?').get(String(id), String(name));
  return !!r;
}

/** 是否群主 */
export function isOwner(id: string, name: string): boolean {
  if (!id || !name) return false;
  const r = open().prepare('SELECT 1 AS x FROM groups WHERE id = ? AND owner = ?').get(String(id), String(name));
  return !!r;
}

/** 新增成员；群不存在返回 false */
export function addMember(id: string, name: string): boolean {
  const d = open();
  const g = d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(String(id));
  if (!g) return false;
  d.prepare('INSERT OR IGNORE INTO group_members (gid, name, joined) VALUES (?, ?, ?)')
    .run(String(id), String(name), Date.now());
  return true;
}

/** 移除成员；群主不可退群（需先转让或解散）；群不存在或非成员返回 false */
export function removeMember(id: string, name: string): boolean {
  const d = open();
  const owner = d.prepare('SELECT owner FROM groups WHERE id = ?').get(String(id)) as { owner: string } | undefined;
  if (!owner) return false;
  if (owner.owner === String(name)) return false; // 群主不可退群
  const r = d.prepare('DELETE FROM group_members WHERE gid = ? AND name = ?').run(String(id), String(name));
  return !!(r && r.changes > 0);
}

/** 重命名群 */
export function renameGroup(id: string, name: string): boolean {
  const d = open();
  const g = d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(String(id));
  if (!g) return false;
  d.prepare('UPDATE groups SET name = ?, updated = ? WHERE id = ?').run(String(name), Date.now(), String(id));
  return true;
}

/** 解散群：删除群信息与全部成员关系 */
export function dissolveGroup(id: string): boolean {
  const d = open();
  const r = d.prepare('DELETE FROM groups WHERE id = ?').run(String(id));
  if (!r || r.changes === 0) return false;
  d.prepare('DELETE FROM group_members WHERE gid = ?').run(String(id));
  return true;
}

/** 用户被删除时清理其全部成员关系（避免成员表遗留孤儿） */
export function removeUserAll(name: string): void {
  open().prepare('DELETE FROM group_members WHERE name = ?').run(String(name));
}

// ---------- 入群申请与审核（申请 → 群主/管理员审核） ----------

const REQ_PENDING = 'pending';
const REQ_APPROVED = 'approved';
const REQ_REJECTED = 'rejected';

/** 按群名校模糊搜索可见群（供“按名称加群”使用，最多返回 20 个） */
export function searchGroups(keyword: string): GroupInfo[] {
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  const like = '%' + kw + '%';
  const rows = open()
    .prepare('SELECT id, name, owner, created FROM groups WHERE name LIKE ? ORDER BY created ASC LIMIT 20')
    .all(like) as { id: string; name: string; owner: string; created: number | null }[];
  return rows.map((r) => {
    const o: GroupInfo = { id: r.id, name: r.name, owner: r.owner };
    if (r.created != null) o.created = r.created;
    return o;
  });
}

/** 列出全部群（仅管理员接口使用） */
export function listAllGroups(): GroupInfo[] {
  const rows = open().prepare('SELECT id, name, owner, created FROM groups ORDER BY created ASC').all() as {
    id: string;
    name: string;
    owner: string;
    created: number | null;
  }[];
  return rows.map((r) => {
    const o: GroupInfo = { id: r.id, name: r.name, owner: r.owner };
    if (r.created != null) o.created = r.created;
    return o;
  });
}

export interface JoinResult {
  ok: boolean;
  reason?: string;
}

/**
 * 提交入群申请。返回 { ok, reason? }
 * 群不存在 / 已是成员 / 已有待处理申请 时不接受。
 */
export function requestJoin(gid: string, name: string): JoinResult {
  const d = open();
  gid = String(gid);
  name = String(name);
  const g = d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(gid);
  if (!g) return { ok: false, reason: '群不存在' };
  if (d.prepare('SELECT 1 AS x FROM group_members WHERE gid = ? AND name = ?').get(gid, name)) {
    return { ok: false, reason: '你已经是该群成员' };
  }
  const dup = d.prepare('SELECT 1 AS x FROM join_requests WHERE gid = ? AND name = ? AND status = ?').get(gid, name, REQ_PENDING);
  if (dup) return { ok: false, reason: '申请已发送，等待群主审核' };
  const rej = d.prepare('SELECT 1 AS x FROM join_requests WHERE gid = ? AND name = ? AND status = ?').get(gid, name, REQ_REJECTED);
  if (rej) return { ok: false, reason: '你曾被拒绝入群，请联系群主' };
  d.prepare('INSERT INTO join_requests (gid, name, created, status) VALUES (?, ?, ?, ?)').run(gid, name, Date.now(), REQ_PENDING);
  return { ok: true };
}

/** 某群的全部待审核入群申请（按时间正序） */
export function pendingRequests(gid: string): { id: number; name: string; created?: number }[] {
  const rows = open()
    .prepare('SELECT id, name, created FROM join_requests WHERE gid = ? AND status = ? ORDER BY created ASC')
    .all(String(gid), REQ_PENDING) as { id: number; name: string; created: number | null }[];
  return rows.map((r) => {
    const o: { id: number; name: string; created?: number } = { id: r.id, name: r.name };
    if (r.created != null) o.created = r.created;
    return o;
  });
}

/** 审核通过入群申请：标记 approved 并把申请人加入成员表；用户不存在 / 已处理返回 false */
export function approveJoin(gid: string, name: string): boolean {
  const d = open();
  gid = String(gid);
  name = String(name);
  const r = d.prepare('SELECT id FROM join_requests WHERE gid = ? AND name = ? AND status = ?').get(gid, name, REQ_PENDING);
  if (!r) return false;
  d.prepare('UPDATE join_requests SET status = ? WHERE id = ?').run(REQ_APPROVED, (r as { id: number }).id);
  d.prepare('INSERT OR IGNORE INTO group_members (gid, name, joined) VALUES (?, ?, ?)').run(gid, name, Date.now());
  return true;
}

/** 拒绝入群申请：标记 rejected；不存在 / 已处理返回 false */
export function rejectJoin(gid: string, name: string): boolean {
  const d = open();
  gid = String(gid);
  name = String(name);
  const r = d.prepare('SELECT id FROM join_requests WHERE gid = ? AND name = ? AND status = ?').get(gid, name, REQ_PENDING);
  if (!r) return false;
  d.prepare('UPDATE join_requests SET status = ? WHERE id = ?').run(REQ_REJECTED, (r as { id: number }).id);
  return true;
}

/** 解散群时清理该群全部入群申请 */
export function removeRequestsOfGroup(gid: string): void {
  open().prepare('DELETE FROM join_requests WHERE gid = ?').run(String(gid));
}

/** 用户被删除时清理其全部入群申请 */
export function removeRequestsOfUser(name: string): void {
  open().prepare('DELETE FROM join_requests WHERE name = ?').run(String(name));
}

/** 转移群主：新群主必须是成员；群主须在指定群内 */
export function transferOwner(gid: string, oldOwner: string, newOwner: string): boolean {
  const d = open();
  gid = String(gid);
  oldOwner = String(oldOwner);
  newOwner = String(newOwner);
  const g = d.prepare('SELECT owner FROM groups WHERE id = ?').get(gid) as { owner: string } | undefined;
  if (!g) return false;
  if (g.owner !== oldOwner) return false; // 仅当前群主可发起转移
  if (!d.prepare('SELECT 1 AS x FROM group_members WHERE gid = ? AND name = ?').get(gid, newOwner)) {
    return false; // 新群主必须是群成员
  }
  d.prepare('UPDATE groups SET owner = ?, updated = ? WHERE id = ?').run(newOwner, Date.now(), gid);
  return true;
}

/** 列出某群全部成员（含是否为群主），供管理面板展示 */
export function manageMembers(id: string): GroupMember[] {
  const owner = open().prepare('SELECT owner FROM groups WHERE id = ?').get(String(id)) as { owner: string } | undefined;
  const ownerName = owner ? owner.owner : '';
  return groupMembers(id).map((m) => ({
    name: m.name,
    owner: m.name === ownerName,
    joined: m.joined != null ? m.joined : null
  }));
}

export interface SetAvatarResult {
  ok: boolean;
  code?: string;
  avatar?: string | null;
}

/** 设置群头像：avatar 为空串或 null 表示清除；仅允许 http(s) 图片地址 */
export function setGroupAvatar(gid: string, avatar: string): SetAvatarResult {
  const d = open();
  gid = String(gid);
  if (!d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(gid)) {
    return { ok: false, code: 'api.group.notFound' };
  }
  const v = avatar == null ? '' : String(avatar).trim().slice(0, 1024);
  // 仅允许 http(s) 图片地址或清空
  if (v && !/^https?:\/\//i.test(v)) {
    return { ok: false, code: 'group.avatarInvalid' };
  }
  d.prepare('UPDATE groups SET avatar = ?, updated = ? WHERE id = ?').run(v || null, Date.now(), gid);
  return { ok: true, avatar: v || null };
}

/** 设置群公告；空串表示清除（最长 500 字） */
export function setAnnouncement(gid: string, text: string): boolean {
  const d = open();
  gid = String(gid);
  if (!d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(gid)) return false;
  const v = text == null ? '' : String(text).trim().slice(0, 500);
  d.prepare('UPDATE groups SET announcement = ?, updated = ? WHERE id = ?').run(v || null, Date.now(), gid);
  return true;
}
