// CircleChat — 好友管理模块（Nitro 版，对应 lib/friends.js）
// 好友申请 / 同意 / 拒绝、好友关系互查、私聊房间 key。
// 权限模型：双向互加（申请后对方同意才算互为好友）。friends 表 u1<u2 按字典序存储。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// server/lib/friends.ts -> ../../data
const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const DB_FILE = path.join(DATA_DIR, 'chatplus.db');

const REQ_PENDING = 'pending';

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  return db;
}

/**
 * 返回两个用户名排序后的 [小, 大] 元组。
 * 用户名规则不含 ':'，私聊房间 key 使用 ':' 连接（安全且可逆）。
 */
function sortedPair(a: string, b: string): [string, string] {
  return [String(a), String(b)].sort() as [string, string];
}

/**
 * 私聊 / 好友关系的唯一标识 key：`小:大`（字母序）。
 */
export function pairKey(a: string, b: string): string {
  return sortedPair(a, b).join(':');
}

/** 是否互为好友 */
export function isFriend(a: string, b: string): boolean {
  if (!a || !b || String(a) === String(b)) return false;
  const pair = sortedPair(a, b);
  const r = open().prepare('SELECT 1 AS x FROM friends WHERE u1 = ? AND u2 = ?').get(pair[0], pair[1]);
  return !!r;
}

export interface FriendResult {
  ok: boolean;
  reason?: string;
}

/** 发送好友申请；返回 {ok, reason?} */
export function sendRequest(from: string, to: string): FriendResult {
  from = String(from);
  to = String(to);
  if (from === to) return { ok: false, reason: 'api.friend.selfAdd' };
  if (isFriend(from, to)) return { ok: false, reason: 'api.friend.already' };
  const d = open();
  const dup = d.prepare('SELECT 1 AS x FROM friend_requests WHERE status = ? AND requester = ? AND target = ?').get(REQ_PENDING, from, to);
  if (dup) return { ok: false, reason: 'api.friend.dup' };
  const rev = d.prepare('SELECT 1 AS x FROM friend_requests WHERE status = ? AND requester = ? AND target = ?').get(REQ_PENDING, to, from);
  if (rev) return { ok: false, reason: 'api.friend.reversePending' };
  d.prepare('INSERT INTO friend_requests (requester, target, created, status) VALUES (?, ?, ?, ?)').run(from, to, Date.now(), REQ_PENDING);
  return { ok: true };
}

/** 对方同意（互加）：写入 friends 并清除 pending 申请 */
export function acceptRequest(target: string, requester: string): boolean {
  const d = open();
  const r = d.prepare('SELECT 1 AS x FROM friend_requests WHERE status = ? AND requester = ? AND target = ?').get(REQ_PENDING, String(requester), String(target));
  if (!r) return false;
  const pair = sortedPair(requester, target);
  d.prepare('INSERT OR IGNORE INTO friends (u1, u2, created) VALUES (?, ?, ?)').run(pair[0], pair[1], Date.now());
  d.prepare('DELETE FROM friend_requests WHERE status = ? AND requester = ? AND target = ?').run(REQ_PENDING, String(requester), String(target));
  return true;
}

/** 拒绝 / 删除申请（仅 target 可处理） */
export function declineRequest(target: string, requester: string): boolean {
  const r = open()
    .prepare('DELETE FROM friend_requests WHERE status = ? AND requester = ? AND target = ?')
    .run(REQ_PENDING, String(requester), String(target));
  return !!(r && r.changes > 0);
}

/** 移除好友关系 */
export function removeFriend(a: string, b: string): boolean {
  const pair = sortedPair(a, b);
  const r = open().prepare('DELETE FROM friends WHERE u1 = ? AND u2 = ?').run(pair[0], pair[1]);
  return !!(r && r.changes > 0);
}

/** 某用户的所有好友用户名 */
export function listFriends(name: string): string[] {
  name = String(name);
  const rows = open().prepare('SELECT u1, u2 FROM friends WHERE u1 = ? OR u2 = ?').all(name, name) as { u1: string; u2: string }[];
  const out: string[] = [];
  for (const r of rows) {
    const other = r.u1 === name ? r.u2 : r.u1;
    if (other) out.push(other);
  }
  return out;
}

export interface IncomingRequest {
  from: string;
  created?: number;
}

/** 对方（target=name、待处理）发来的申请用户名列表 */
export function listRequests(name: string): IncomingRequest[] {
  const rows = open()
    .prepare('SELECT requester, created FROM friend_requests WHERE target = ? AND status = ? ORDER BY created ASC')
    .all(String(name), REQ_PENDING) as { requester: string; created: number | null }[];
  return rows.map((r) => {
    const o: IncomingRequest = { from: r.requester };
    if (r.created != null) o.created = r.created;
    return o;
  });
}

export interface SentRequest {
  to: string;
  created?: number;
}

/** 我方已发出、等待对方处理的申请 */
export function listSent(name: string): SentRequest[] {
  const rows = open()
    .prepare('SELECT target, created FROM friend_requests WHERE requester = ? AND status = ? ORDER BY created ASC')
    .all(String(name), REQ_PENDING) as { target: string; created: number | null }[];
  return rows.map((r) => {
    const o: SentRequest = { to: r.target };
    if (r.created != null) o.created = r.created;
    return o;
  });
}

/** 用户被删除时清理其全部好友关系与申请（对称清理，避免遗留孤儿） */
export function removeUserAll(name: string): void {
  const d = open();
  d.prepare('DELETE FROM friend_requests WHERE requester = ?').run(String(name));
  d.prepare('DELETE FROM friend_requests WHERE target = ?').run(String(name));
  d.prepare('DELETE FROM friends WHERE u1 = ?').run(String(name));
  d.prepare('DELETE FROM friends WHERE u2 = ?').run(String(name));
}
