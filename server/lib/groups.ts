// CircleChat — 群组管理模块（Nitro 版，对应 lib/groups.js）
// 群组创建 / 解散 / 重命名、成员加入 / 退出 / 查询、入群申请与审核。
// 权限模型：群所有者（owner）可管理本人群；全局 admin 可管理任意群；普通成员可加入 / 退出。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isValidAvatar, safeAvatar } from './avatar';

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
  muteAll?: boolean;
  memberInviteApprove?: boolean;
}

export interface GroupMember {
  name: string;
  owner?: boolean;
  role?: 'member' | 'admin';
  nickname?: string | null;
  muted?: boolean;
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

export function listGroupsOf(name: string): GroupInfo[] {
  const d = open();
  const rows = d.prepare(
    'SELECT g.id, g.name, g.owner, g.created, g.avatar, g.announcement FROM group_members gm ' +
    'JOIN groups g ON g.id = gm.gid WHERE gm.name = ? ORDER BY g.created ASC'
  ).all(String(name)) as { id: string; name: string; owner: string; created: number | null; avatar: string | null; announcement: string | null }[];
  return rows.map((r) => {
    const o: GroupInfo = { id: r.id, name: r.name, owner: r.owner };
    if (r.created != null) o.created = r.created;
    const av = safeAvatar(r.avatar);
    if (av) o.avatar = av;
    if (r.announcement != null) o.announcement = r.announcement;
    return o;
  });
}

export function getGroup(id: string): GroupInfo | null {
  const r = open().prepare('SELECT id, name, owner, created, updated, avatar, announcement, mute_all, member_invite_approve FROM groups WHERE id = ?').get(String(id)) as
    | (GroupInfo & { created: number | null; mute_all: number | null; member_invite_approve: number | null })
    | undefined;
  if (!r) return null;
  const o = r as GroupInfo & { created: number | null };
  const av = safeAvatar(r.avatar);
  if (av) o.avatar = av;
  else delete (o as { avatar?: string | null }).avatar;
  if (r.mute_all) o.muteAll = true;
  if (r.member_invite_approve) o.memberInviteApprove = true;
  return o;
}

export function groupMembers(id: string): GroupMember[] {
  const rows = open().prepare('SELECT name, joined, role, nickname, muted FROM group_members WHERE gid = ? ORDER BY joined ASC').all(String(id)) as
    | { name: string; joined: number | null; role: string | null; nickname: string | null; muted: number | null }[]
    | undefined;
  const list = rows || [];
  return list.map((r) => {
    const o: GroupMember = { name: r.name };
    if (r.joined != null) o.joined = r.joined;
    if (r.role === 'admin') o.role = 'admin';
    if (r.nickname != null) o.nickname = r.nickname;
    if (r.muted) o.muted = true;
    return o;
  });
}

export function isMember(id: string, name: string): boolean {
  if (!id || !name) return false;
  const r = open().prepare('SELECT 1 AS x FROM group_members WHERE gid = ? AND name = ?').get(String(id), String(name));
  return !!r;
}

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
  const d = open();
  const n = String(name);
  d.prepare('DELETE FROM group_members WHERE name = ?').run(n);
  d.prepare('DELETE FROM group_invites WHERE inviter = ? OR invitee = ?').run(n, n);
  d.prepare('DELETE FROM group_remarks WHERE u = ?').run(n);
  d.prepare('DELETE FROM friend_remarks WHERE u1 = ? OR u2 = ?').run(n, n);
}


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

/** 解散群时清理该群全部入群申请与邀请 */
export function removeRequestsOfGroup(gid: string): void {
  const d = open();
  d.prepare('DELETE FROM join_requests WHERE gid = ?').run(String(gid));
  d.prepare('DELETE FROM group_invites WHERE gid = ?').run(String(gid));
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
  // 转让后：旧群主与新群主都不再是「管理员」角色（群主由 groups.owner 标识）
  d.prepare('UPDATE group_members SET role = ? WHERE gid = ? AND name = ?').run('member', gid, oldOwner);
  d.prepare('UPDATE group_members SET role = ? WHERE gid = ? AND name = ?').run('member', gid, newOwner);
  return true;
}

/** 列出某群全部成员（含是否为群主），供管理面板展示 */
export function manageMembers(id: string): GroupMember[] {
  const owner = open().prepare('SELECT owner FROM groups WHERE id = ?').get(String(id)) as { owner: string } | undefined;
  const ownerName = owner ? owner.owner : '';
  return groupMembers(id).map((m) => ({
    name: m.name,
    owner: m.name === ownerName,
    role: m.role,
    nickname: m.nickname,
    muted: m.muted,
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
  // 与本人头像一致：只接受本站上传的图片路径（空串 = 清除）
  if (!isValidAvatar(v)) {
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

// ---------- 群角色 / 群昵称 / 禁言 ----------

/** 是否群管理员（群主本身不算「管理员」角色，用 isOwner 判定） */
export function isGroupAdmin(gid: string, name: string): boolean {
  if (!gid || !name) return false;
  const r = open().prepare('SELECT role FROM group_members WHERE gid = ? AND name = ?').get(String(gid), String(name)) as
    | { role: string | null }
    | undefined;
  return !!r && r.role === 'admin' && !isOwner(gid, name);
}

/** 是否本群管理者：群主或群管理员 */
export function isManager(gid: string, name: string): boolean {
  return isOwner(gid, name) || isGroupAdmin(gid, name);
}

/** 设置成员角色：'admin' | 'member'（群主不可被设） */
export function setMemberRole(gid: string, name: string, role: 'admin' | 'member'): boolean {
  const d = open();
  gid = String(gid);
  name = String(name);
  if (!d.prepare('SELECT 1 AS x FROM group_members WHERE gid = ? AND name = ?').get(gid, name)) return false;
  if (isOwner(gid, name)) return false; // 群主角色固定，不接受设置
  d.prepare('UPDATE group_members SET role = ? WHERE gid = ? AND name = ?').run(role === 'admin' ? 'admin' : 'member', gid, name);
  return true;
}

/** 设置「我在本群的昵称」；空串表示清除（最长 24 字） */
export function setNickname(gid: string, name: string, nickname: string): boolean {
  const d = open();
  gid = String(gid);
  name = String(name);
  if (!d.prepare('SELECT 1 AS x FROM group_members WHERE gid = ? AND name = ?').get(gid, name)) return false;
  const v = nickname == null ? '' : String(nickname).trim().slice(0, 24);
  d.prepare('UPDATE group_members SET nickname = ? WHERE gid = ? AND name = ?').run(v || null, gid, name);
  return true;
}

/** 单独成员禁言（仅群主/管理员操作；群主/管理员不可被禁言） */
export function setMuted(gid: string, name: string, muted: boolean): boolean {
  const d = open();
  gid = String(gid);
  name = String(name);
  if (!d.prepare('SELECT 1 AS x FROM group_members WHERE gid = ? AND name = ?').get(gid, name)) return false;
  if (isManager(gid, name)) return false; // 管理者不可被禁言
  d.prepare('UPDATE group_members SET muted = ? WHERE gid = ? AND name = ?').run(muted ? 1 : 0, gid, name);
  return true;
}

export function isMutedMember(gid: string, name: string): boolean {
  const r = open().prepare('SELECT muted FROM group_members WHERE gid = ? AND name = ?').get(String(gid), String(name)) as
    | { muted: number | null }
    | undefined;
  return !!r && !!r.muted;
}


export function setMuteAll(gid: string, val: boolean): boolean {
  const d = open();
  gid = String(gid);
  if (!d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(gid)) return false;
  d.prepare('UPDATE groups SET mute_all = ?, updated = ? WHERE id = ?').run(val ? 1 : 0, Date.now(), gid);
  return true;
}

export function isMuteAll(gid: string): boolean {
  const r = open().prepare('SELECT mute_all FROM groups WHERE id = ?').get(String(gid)) as
    | { mute_all: number | null }
    | undefined;
  return !!r && !!r.mute_all;
}

export function setMemberInviteApprove(gid: string, val: boolean): boolean {
  const d = open();
  gid = String(gid);
  if (!d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(gid)) return false;
  d.prepare('UPDATE groups SET member_invite_approve = ?, updated = ? WHERE id = ?').run(val ? 1 : 0, Date.now(), gid);
  return true;
}

export function memberInviteApprove(gid: string): boolean {
  const r = open().prepare('SELECT member_invite_approve FROM groups WHERE id = ?').get(String(gid)) as
    | { member_invite_approve: number | null }
    | undefined;
  return !!r && !!r.member_invite_approve;
}

/** 发群消息是否被拦截：群禁言（非管理者）或 单独禁言（非群主） */
export function speakBlocked(gid: string, name: string): boolean {
  if (!gid || !name) return false;
  if (isOwner(gid, name) || isGroupAdmin(gid, name)) return false;
  if (isMuteAll(gid)) return true;
  if (isMutedMember(gid, name)) return true;
  return false;
}


export const INV_PENDING = 'pending';
export const INV_NEEDS_APPROVAL = 'needs_approval';
export const INV_ACCEPTED = 'accepted';
export const INV_REJECTED = 'rejected';

export interface GroupInvite {
  id: number;
  gid: string;
  inviter: string;
  invitee: string;
  created?: number;
  status: string;
  note?: string | null;
}

/**
 * 创建邀请。返回初始状态：
 * - 邀请人是管理者（群主/管理员）：直接 pending（等被邀请人同意）
 * - 普通成员且群开启「成员邀请需审批」：needs_approval（等群主/管理员批准后再等被邀请人同意）
 * - 普通成员且未开启审批：直接 pending
 */
export function createInvite(gid: string, inviter: string, invitee: string): { ok: boolean; reason?: string; id?: number; status?: string } {
  const d = open();
  gid = String(gid);
  inviter = String(inviter);
  invitee = String(invitee);
  if (!d.prepare('SELECT 1 AS x FROM groups WHERE id = ?').get(gid)) return { ok: false, reason: '群不存在' };
  if (!isMember(gid, inviter)) return { ok: false, reason: '你不是该群成员' };
  if (!invitee) return { ok: false, reason: '被邀请人无效' };
  if (isMember(gid, invitee)) return { ok: false, reason: '对方已是群成员' };
  const dup = d.prepare('SELECT id FROM group_invites WHERE gid = ? AND inviter = ? AND invitee = ? AND status IN (?, ?)')
    .get(gid, inviter, invitee, INV_PENDING, INV_NEEDS_APPROVAL);
  if (dup) return { ok: false, reason: '已向该用户发送过邀请' };
  const status = (!isManager(gid, inviter) && memberInviteApprove(gid)) ? INV_NEEDS_APPROVAL : INV_PENDING;
  const r = d.prepare('INSERT INTO group_invites (gid, inviter, invitee, created, status) VALUES (?, ?, ?, ?, ?)')
    .run(gid, inviter, invitee, Date.now(), status);
  return { ok: true, id: Number(r.lastInsertRowid), status };
}

/** 群主/管理员批准一条「需审批」的邀请 */
export function approveInvite(id: number, approver: string): boolean {
  const d = open();
  const r = d.prepare('SELECT gid, status FROM group_invites WHERE id = ?').get(Number(id)) as
    | { gid: string; status: string }
    | undefined;
  if (!r) return false;
  if (r.status !== INV_NEEDS_APPROVAL) return false;
  if (!isManager(r.gid, approver)) return false;
  d.prepare('UPDATE group_invites SET status = ? WHERE id = ?').run(INV_PENDING, Number(id));
  return true;
}

/** 拒绝 / 撤销一条邀请（邀请人、被邀请人、管理者均可） */
export function rejectInvite(id: number, who: string): boolean {
  const d = open();
  const r = d.prepare('SELECT gid, inviter, invitee, status FROM group_invites WHERE id = ?').get(Number(id)) as
    | { gid: string; inviter: string; invitee: string; status: string }
    | undefined;
  if (!r) return false;
  if (who !== r.inviter && who !== r.invitee && !isManager(r.gid, who)) return false;
  if (r.status === INV_ACCEPTED) return false;
  d.prepare('UPDATE group_invites SET status = ? WHERE id = ?').run(INV_REJECTED, Number(id));
  return true;
}

export function acceptInvite(id: number, invitee: string): boolean {
  const d = open();
  const r = d.prepare('SELECT gid, invitee, status FROM group_invites WHERE id = ?').get(Number(id)) as
    | { gid: string; invitee: string; status: string }
    | undefined;
  if (!r) return false;
  if (r.invitee !== String(invitee)) return false;
  if (r.status !== INV_PENDING) return false;
  if (isMember(r.gid, invitee)) return false;
  d.prepare('UPDATE group_invites SET status = ? WHERE id = ?').run(INV_ACCEPTED, Number(id));
  d.prepare('INSERT OR IGNORE INTO group_members (gid, name, joined) VALUES (?, ?, ?)').run(r.gid, String(invitee), Date.now());
  return true;
}

export function invitesForMe(name: string): GroupInvite[] {
  const rows = open().prepare('SELECT id, gid, inviter, created, status, note FROM group_invites WHERE invitee = ? AND status = ? ORDER BY created DESC')
    .all(String(name), INV_PENDING) as { id: number; gid: string; inviter: string; created: number | null; status: string; note: string | null }[];
  return rows.map((r) => ({ id: r.id, gid: r.gid, inviter: r.inviter, invitee: String(name), created: r.created != null ? r.created : undefined, status: r.status, note: r.note }));
}

export function pendingApprovals(gid: string): GroupInvite[] {
  const rows = open().prepare('SELECT id, inviter, invitee, created, status, note FROM group_invites WHERE gid = ? AND status = ? ORDER BY created ASC')
    .all(String(gid), INV_NEEDS_APPROVAL) as { id: number; inviter: string; invitee: string; created: number | null; status: string; note: string | null }[];
  return rows.map((r) => ({ id: r.id, gid: String(gid), inviter: r.inviter, invitee: r.invitee, created: r.created != null ? r.created : undefined, status: r.status, note: r.note }));
}

/** 管理面板用：某群全部未完成邀请（待审批 + 待接受） */
export function invitesByGroup(gid: string): GroupInvite[] {
  const rows = open().prepare('SELECT id, inviter, invitee, created, status, note FROM group_invites WHERE gid = ? AND status IN (?, ?) ORDER BY created DESC')
    .all(String(gid), INV_PENDING, INV_NEEDS_APPROVAL) as { id: number; inviter: string; invitee: string; created: number | null; status: string; note: string | null }[];
  return rows.map((r) => ({ id: r.id, gid: String(gid), inviter: r.inviter, invitee: r.invitee, created: r.created != null ? r.created : undefined, status: r.status, note: r.note }));
}

/** 群头像文件名集合（groups.avatar 的 basename），用于文件保护 */
export function avatarFiles(): Set<string> {
  const set = new Set<string>();
  const rows = open().prepare("SELECT avatar FROM groups WHERE avatar IS NOT NULL AND avatar != ''").all() as { avatar: string | null }[];
  for (const r of rows) {
    if (!r.avatar) continue;
    const b = String(r.avatar).split(/[\\/]/).pop() || '';
    if (b && b !== r.avatar) set.add(b);
  }
  return set;
}

/** 按 id 取一条邀请（含 gid/inviter/invitee/status） */
export function getInvite(id: number): GroupInvite | null {
  const r = open().prepare('SELECT id, gid, inviter, invitee, created, status, note FROM group_invites WHERE id = ?').get(Number(id)) as
    | { id: number; gid: string; inviter: string; invitee: string; created: number | null; status: string; note: string | null }
    | undefined;
  if (!r) return null;
  return { id: r.id, gid: r.gid, inviter: r.inviter, invitee: r.invitee, created: r.created != null ? r.created : undefined, status: r.status, note: r.note };
}

// ---------- 群备注 / 好友备注（仅本人可见） ----------

export function setGroupRemark(u: string, gid: string, remark: string): boolean {
  const d = open();
  const v = remark == null ? '' : String(remark).slice(0, 500);
  d.prepare('INSERT INTO group_remarks (u, gid, remark, updated) VALUES (?, ?, ?, ?) ON CONFLICT(u, gid) DO UPDATE SET remark = excluded.remark, updated = excluded.updated')
    .run(String(u), String(gid), v || null, Date.now());
  return true;
}

export function getGroupRemark(u: string, gid: string): string | null {
  const r = open().prepare('SELECT remark FROM group_remarks WHERE u = ? AND gid = ?').get(String(u), String(gid)) as
    | { remark: string | null }
    | undefined;
  return r && r.remark != null ? r.remark : null;
}

function normFriendPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function setFriendRemark(u1: string, u2: string, remark: string): boolean {
  const d = open();
  const [a, b] = normFriendPair(String(u1), String(u2));
  const v = remark == null ? '' : String(remark).slice(0, 500);
  d.prepare('INSERT INTO friend_remarks (u1, u2, remark, updated) VALUES (?, ?, ?, ?) ON CONFLICT(u1, u2) DO UPDATE SET remark = excluded.remark, updated = excluded.updated')
    .run(a, b, v || null, Date.now());
  return true;
}

export function getFriendRemark(u1: string, u2: string): string | null {
  const [a, b] = normFriendPair(String(u1), String(u2));
  const r = open().prepare('SELECT remark FROM friend_remarks WHERE u1 = ? AND u2 = ?').get(a, b) as
    | { remark: string | null }
    | undefined;
  return r && r.remark != null ? r.remark : null;
}
