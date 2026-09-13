/* ============================================================
 * CircleChat 前端 — 聊天核心（组合式单例）
 * 封装 WebSocket 连接、REST 调用、消息收发与会话状态。
 * 所有组件 import 同一个实例，状态天然共享。
 * ============================================================ */

import { reactive } from 'vue';
import { get, post, url } from './api';
import { config } from './config';
import { tr } from './i18n';
import { fmtSize } from './format';
import type {
  ChatMessage,
  ChatUser,
  Friend,
  FriendRequest,
  FriendSent,
  ChatGroup,
  GroupMember,
  ProfileData
} from '../types';

const PAGE = 30; // 每批渲染 / 加载条数
const MAX_UPLOAD_SIZE = 20 * 1024 * 1024; // 20MB
const GROUP_GAP_MS = 5 * 60 * 1000; // 同一人 5 分钟内连发视为一组

function clock(ts?: number | null): string {
  const d = new Date(Number(ts) || Date.now());
  const p = (n: number) => (n < 10 ? '0' + n : String(n));
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 把 /uploads/xxx 转成可访问的完整地址（兼容跨域 apiBase） */
function asset(u: string): string {
  if (/^[a-z]+:/i.test(u)) return u; // 已是绝对地址
  return url(u);
}

function api(path: string): string {
  return url(path);
}

export interface ChatState {
  me: string;
  role: string;
  isAdmin: boolean;
  online: string[];
  allUsers: ChatUser[];
  userImages: Record<string, string | null>;
  myGroups: ChatGroup[];
  myFriends: Friend[];
  friendRequests: FriendRequest[];
  friendSent: FriendSent[];
  activeGroupMembers: GroupMember[];
  activeGid: string | null;
  activeDmPeer: string | null;
  messages: ChatMessage[];
  renderedIdx: Record<string, boolean>;
  topIndex: number;
  connState: 'on' | 'conn' | 'off';
  typingWho: string | null;
  notifyOn: boolean;
  replyTo: ChatMessage | null;
  profileOpen: boolean;
  profile: ProfileData | null;
  friendSearchOpen: boolean;
  groupDialogOpen: boolean;
  groupDialogTab: 'create' | 'join' | 'search';
  error: string;
  loadingHistory: boolean;
  contextMenu: { idx: number; x: number; y: number } | null;
  selectMode: boolean;
  selected: number[];
  forwardOpen: boolean;
  forwardSource: number[];
  forwardMode: 'single' | 'merge';
  reactTargetIdx: number | null;
}

const state = reactive<ChatState>({
  me: '',
  role: 'user',
  isAdmin: false,
  online: [],
  allUsers: [],
  userImages: {},
  myGroups: [],
  myFriends: [],
  friendRequests: [],
  friendSent: [],
  activeGroupMembers: [],
  activeGid: null,
  activeDmPeer: null,
  messages: [],
  renderedIdx: {},
  topIndex: 0,
  connState: 'off',
  typingWho: null,
  notifyOn: true,
  replyTo: null,
  profileOpen: false,
  profile: null,
  friendSearchOpen: false,
  groupDialogOpen: false,
  groupDialogTab: 'create',
  error: '',
  loadingHistory: false,
  contextMenu: null,
  selectMode: false,
  selected: [],
  forwardOpen: false,
  forwardSource: [],
  forwardMode: 'single',
  reactTargetIdx: null
});

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let reconnectTimer: number | undefined;
let heartbeatTimer: number | undefined;
let connectedOnce = false;
let usersReady: Promise<void> | null = null;
let typingSentAt = 0;
let typingHideTimer: number | undefined;

// ---------------- WebSocket ----------------

function wsUrl(): string {
  const base = config.apiBase;
  if (base) {
    const u = new URL(base);
    return (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/ws';
  }
  // 端点固定在同源的 /ws，不能基于页面 pathname 拼接（如 /chat.html/ws 会 404）
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  return proto + location.host + '/ws';
}

function setConn(s: ChatState['connState']): void {
  state.connState = s;
}

function send(obj: Record<string, unknown>): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

function scheduleReconnect(): void {
  clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => {
    connectWs();
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }, reconnectDelay);
}

function connectWs(): void {
  setConn('conn');
  let sock: WebSocket;
  try {
    sock = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  ws = sock;

  sock.onopen = () => {
    connectedOnce = true;
    setConn('on');
    reconnectDelay = 1000;
    clearInterval(heartbeatTimer);
    heartbeatTimer = window.setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 30000);
    loadHistory();
  };

  sock.onmessage = (ev: MessageEvent) => {
    let obj: { type?: string; data?: any; from?: string; users?: string[]; by?: string; owner?: string; admin?: boolean } | null = null;
    try {
      obj = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    switch (obj.type) {
      case 'msg':
        if (obj.data && msgInActiveRoom(obj.data)) appendMsg(obj.data);
        break;
      case 'recall':
        if (obj.data) handleRecall(obj.data);
        break;
      case 'typing':
        if (obj.from && obj.from !== state.me && obj.from === state.activeDmPeer) showTyping(obj.from);
        break;
      case 'reaction':
        if (obj.data) handleReaction(obj.data);
        break;
      case 'presence':
        state.online = obj.users || [];
        break;
      case 'groups.changed':
        loadGroups();
        break;
      case 'friends.changed':
        loadFriends();
        break;
      default:
        break;
    }
  };

  sock.onclose = () => {
    setConn('off');
    clearInterval(heartbeatTimer);
    if (ws !== sock) return;
    if (!connectedOnce) {
      get('/api/me')
        .then((j) => {
          if (!j.ok) location.replace('/login.html');
          else scheduleReconnect();
        })
        .catch(() => scheduleReconnect());
    } else {
      scheduleReconnect();
    }
  };

  sock.onerror = () => {
    try {
      sock.close();
    } catch {
      /* 忽略 */
    }
  };
}

// ---------------- 消息处理 ----------------

export function msgInActiveRoom(m: ChatMessage): boolean {
  if (state.activeGid != null) return String(m.gid) === String(state.activeGid);
  if (state.activeDmPeer != null) {
    if (m.dm == null) return false;
    return String(m.dm).split(':').indexOf(String(state.activeDmPeer)) !== -1;
  }
  return m.gid == null && m.dm == null;
}

function appendMsg(m: ChatMessage): void {
  if (m.idx != null) {
    const k = String(m.idx);
    if (state.renderedIdx[k]) return;
    state.renderedIdx[k] = true;
  }
  state.messages.push(m);
}

function handleRecall(data: { idx?: number; by?: string; owner?: string; admin?: boolean }): void {
  if (data.idx == null) return;
  for (const m of state.messages) {
    if (m.idx === data.idx) {
      m.recalled = 1;
      (m as any).recalled_by = data.by || '';
      break;
    }
  }
}

function handleReaction(data: { idx?: number; reactions?: { emoji: string; users: string[] }[] }): void {
  if (data.idx == null) return;
  for (const m of state.messages) {
    if (m.idx === data.idx) {
      m.reactions = data.reactions || [];
      break;
    }
  }
}

export function canGroup(prev: ChatMessage | undefined, cur: ChatMessage): boolean {
  if (!prev) return false;
  if (prev.from !== cur.from) return false;
  if (prev.recalled || cur.recalled) return false;
  const p = Number(prev.ts || prev.time || 0);
  const c = Number(cur.ts || cur.time || 0);
  if (!p || !c) return false;
  return c - p <= GROUP_GAP_MS;
}

export function mentionsMe(text?: string): boolean {
  if (!text) return false;
  return mentionsOf(text).indexOf(state.me) !== -1;
}

function mentionsOf(text: string): string[] {
  const out = new Set<string>();
  const names = state.allUsers.map((u) => u.name);
  if (!names.length) return [];
  const re = new RegExp('@(?:' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[0].slice(1));
  return [...out];
}

// ---------------- 历史 / 会话 ----------------

function loadHistory(): void {
  // 移除公共频道：未选择任何会话（原先的公共房 gid=null&dm=null）时不加载
  if (state.activeGid == null && state.activeDmPeer == null) {
    state.loadingHistory = false;
    return;
  }
  state.loadingHistory = true;
  const ready = usersReady || Promise.resolve();
  ready
    .then(() => {
      let u = api('/api/messages');
      if (state.activeGid != null) u += '?gid=' + encodeURIComponent(state.activeGid);
      else if (state.activeDmPeer != null) u += '?dm=' + encodeURIComponent(state.activeDmPeer);
      return get(u);
    })
    .then((j) => {
      state.loadingHistory = false;
      if (j && j.ok) renderHistory((j.messages as ChatMessage[]) || []);
    })
    .catch(() => {
      state.loadingHistory = false;
    });
}

function renderHistory(list: ChatMessage[]): void {
  state.messages = (list || []).slice();
  state.renderedIdx = {};
  for (const m of state.messages) if (m.idx != null) state.renderedIdx[String(m.idx)] = true;
  state.topIndex = Math.max(0, state.messages.length - PAGE);
}

export function loadOlder(): void {
  if (state.topIndex <= 0) return;
  state.topIndex = Math.max(0, state.topIndex - PAGE);
}

export function switchRoom(gid: string | null): void {
  state.activeGid = gid == null ? null : String(gid);
  state.activeDmPeer = null;
  state.replyTo = null;
  state.activeGroupMembers = [];
  resetRoom();
  if (gid != null) loadGroupMembers(gid);
  loadHistory();
}

export function switchRoomToDm(peer: string): void {
  const p = String(peer || '');
  if (!p || p === state.me) return;
  state.activeDmPeer = p;
  state.activeGid = null;
  state.replyTo = null;
  resetRoom();
  loadHistory();
}

function resetRoom(): void {
  state.messages = [];
  state.renderedIdx = {};
  state.topIndex = 0;
}

// ---------------- 加载数据 ----------------

function loadMe(): Promise<boolean> {
  return get('/api/me').then((j) => {
    if (!j.ok) {
      location.replace('/login.html');
      return false;
    }
    state.me = String(j.username || '');
    state.role = String(j.role || 'user');
    state.isAdmin = state.role === 'admin';
    state.online = (j.online as string[]) || [];
    return true;
  });
}

function loadUsers(): Promise<void> {
  if (!usersReady) {
    usersReady = get('/api/users')
      .then((j) => {
        if (j.ok) {
          state.allUsers = (j.users as ChatUser[]) || [];
          state.userImages = {};
          state.allUsers.forEach((u) => {
            state.userImages[u.name] = u.image || null;
          });
        }
      })
      .catch(() => {
        /* 忽略 */
      });
  }
  return usersReady;
}

function loadFriends(): Promise<void> {
  return get('/api/friends')
    .then((j) => {
      if (!j.ok) return;
      state.myFriends = (j.friends as Friend[]) || [];
      state.friendRequests = (j.requests as FriendRequest[]) || [];
      state.friendSent = (j.sent as FriendSent[]) || [];
    })
    .catch(() => {
      /* 忽略 */
    });
}

function loadGroups(): Promise<void> {
  return get('/api/groups')
    .then((j) => {
      if (j.ok) state.myGroups = (j.groups as ChatGroup[]) || [];
    })
    .catch(() => {
      /* 忽略 */
    });
}

// ---------------- 发送 ----------------

export function sendText(text: string): void {
  const val = (text || '').trim();
  if (!val) return;
  if (dmgating() && state.replyTo) {
    state.replyTo = null;
    return;
  }
  const data: Record<string, unknown> = { type: 'text', content: val };
  if (state.activeGid != null) data.gid = state.activeGid;
  if (state.activeDmPeer != null) data.pm = state.activeDmPeer;
  if (state.replyTo && state.replyTo.idx != null) data.replyTo = state.replyTo.idx;
  if (!send({ type: 'msg', data })) return;
  state.replyTo = null;
}

async function uploadOne(file: File): Promise<void> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(api('/api/upload'), {
    method: 'POST',
    body: fd,
    credentials: 'same-origin'
  });
  const body = await res.json();
  if (!body.ok) {
    state.error = body.error || 'chat.upload.failed';
    return;
  }
  if (dmgating() && body.kind !== 'image') {
    state.error = 'chat.dm.gateToast';
    return;
  }
  const data: Record<string, unknown> = { type: body.kind, content: body.url, name: body.name, size: body.size };
  if (state.activeGid != null) data.gid = state.activeGid;
  if (state.activeDmPeer != null) data.pm = state.activeDmPeer;
  send({ type: 'msg', data });
}

export async function uploadFiles(files: FileList | File[]): Promise<void> {
  const gating = dmgating();
  const list: File[] = [];
  for (const f of Array.from(files)) {
    if (gating && !/^image\//.test(f.type || '')) {
      state.error = 'chat.dm.gateToast';
      continue;
    }
    if (f.size > MAX_UPLOAD_SIZE) {
      state.error = tr('chat.upload.tooBig', { name: f.name || tr('chat.file.defaultName') });
      continue;
    }
    list.push(f);
  }
  for (const f of list) {
    await uploadOne(f);
  }
}

export function notifyTyping(): void {
  const now = Date.now();
  if (now - typingSentAt < 2000) return;
  typingSentAt = now;
  send({ type: 'typing' });
}

function showTyping(name: string): void {
  state.typingWho = name;
  clearTimeout(typingHideTimer);
  typingHideTimer = window.setTimeout(() => {
    state.typingWho = null;
  }, 3500);
}

// ---------------- 操作 ----------------

export function react(idx: number, emoji: string): void {
  send({ type: 'react', data: { idx, emoji } });
}

export function recall(idx: number): void {
  send({ type: 'recall', data: { idx } });
}

// ---------------- 右键菜单 / 多选 / 转发 ----------------

export function openContextMenu(idx: number, x: number, y: number): void {
  state.contextMenu = { idx, x, y };
}

export function closeContextMenu(): void {
  state.contextMenu = null;
}

export function toggleSelectMode(): void {
  state.selectMode = !state.selectMode;
  if (!state.selectMode) state.selected = [];
}

export function toggleSelect(idx: number | undefined): void {
  if (idx == null) return;
  const i = state.selected.indexOf(idx);
  if (i >= 0) state.selected.splice(i, 1);
  else state.selected.push(idx);
}

export function startSelectWith(idx: number | undefined): void {
  if (idx == null) return;
  state.selectMode = true;
  state.selected = [idx];
}

export function clearSelect(): void {
  state.selected = [];
}

export function openForward(source: number[], mode: 'single' | 'merge'): void {
  state.forwardSource = source.filter((x) => x != null);
  state.forwardMode = mode;
  state.forwardOpen = true;
}

export function closeForward(): void {
  state.forwardOpen = false;
}

function findMsg(idx: number): ChatMessage | undefined {
  return state.messages.find((m) => m.idx === idx);
}

function fmtForward(m: ChatMessage): string {
  if (m.type === 'text') return m.content || '';
  if (m.type === 'image') return '[图片]';
  if (m.type === 'file') return '[文件] ' + (m.name || '');
  return '';
}

/** 转发：逐条 = 每条各自发送；合并 = 拼成一条文本消息发送。target 形如 { gid } 或 { pm } */
export function forwardTo(target: { gid?: string; pm?: string }): void {
  const msgs = (state.forwardSource || []).map(findMsg).filter((m): m is ChatMessage => !!m);
  if (!msgs.length) return;
  const merge = state.forwardMode === 'merge';
  if (merge) {
    const lines = msgs.map((m) => (m.from || '?') + '：' + fmtForward(m));
    const content = '「合并转发 ' + msgs.length + ' 条消息」\n' + lines.join('\n');
    send({ type: 'msg', data: { type: 'text', content, ...target } });
  } else {
    for (const m of msgs) {
      const data: Record<string, unknown> = { type: m.type, content: m.content };
      if (m.type !== 'text') {
        data.name = m.name;
        data.size = m.size;
      }
      send({ type: 'msg', data: { ...data, ...target } });
    }
  }
  closeForward();
  clearSelect();
  closeContextMenu();
}

export function isFriend(name: string): boolean {
  return state.myFriends.some((f) => f.name === name);
}

export function dmgating(): boolean {
  return state.activeDmPeer != null && !isFriend(state.activeDmPeer);
}

export function getProfile(name: string): Promise<void> {
  state.profile = null;
  state.profileOpen = true;
  return get('/api/profile?name=' + encodeURIComponent(name)).then((j) => {
    if (j.ok) state.profile = j as unknown as ProfileData;
  });
}

export function closeProfile(): void {
  state.profileOpen = false;
  state.profile = null;
}

export function friendRequest(to: string): Promise<void> {
  return post('/api/friends/request', { to }).then(() => loadFriends());
}

export function friendAccept(from: string): Promise<void> {
  return post('/api/friends/accept', { from }).then(() => loadFriends());
}

export function friendDecline(from: string): Promise<void> {
  return post('/api/friends/decline', { from }).then(() => loadFriends());
}

export function groupCreate(name: string): Promise<void> {
  return post('/api/groups', { name }).then(() => loadGroups());
}

export function groupJoin(gid: string): Promise<void> {
  return post('/api/groups/join', { gid }).then(() => loadGroups());
}

export function groupSearch(keyword: string): Promise<ChatGroup[]> {
  return get('/api/groups/search?name=' + encodeURIComponent(keyword)).then((j) => {
    return (j.ok ? (j.groups as ChatGroup[]) : []) || [];
  });
}

export function groupLeave(gid: string): Promise<void> {
  return post('/api/groups/leave', { gid }).then(() => loadGroups());
}

export async function saveSettings(patch: Record<string, unknown>): Promise<void> {
  await post('/api/settings', patch);
  if (typeof patch.notify === 'boolean') state.notifyOn = patch.notify;
}

export function initChat(): void {
  loadMe().then((ok) => {
    if (!ok) return;
    Promise.all([loadUsers(), loadFriends(), loadGroups()]).then(() => {
      // 移除公共频道：默认进入第一个群组；若没有任何会话则保持空状态由用户自选
      if (state.activeGid == null && state.activeDmPeer == null && state.myGroups.length) {
        switchRoom(state.myGroups[0].id);
      }
      connectWs();
    });
    get('/api/settings')
      .then((j) => {
        if (j.ok && j.settings && (j.settings as any).notify != null) state.notifyOn = !!(j.settings as any).notify;
      })
      .catch(() => {
        /* 忽略 */
      });
  });
}

export function logout(): void {
  post('/api/logout', {}).catch(() => {
    /* 忽略 */
  });
  location.replace('/login.html');
}

// ---------------- 工具（组件复用） ----------------

const PALETTE = ['#07c160', '#10aeff', '#f76260', '#ffc300', '#6467f0', '#ff7a45', '#34c759', '#ff2d55', '#5ac8fa', '#a2845e', '#5856d6', '#ff9500'];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function avatarFor(name: string): string | null {
  return state.userImages[name] || null;
}

export function isOnline(name: string): boolean {
  return state.online.indexOf(name) !== -1 || name === state.me;
}

export function copyToClipboard(text: string): void {
  const t = String(text || '');
  try {
    const c = (navigator as unknown as { clipboard?: { writeText?: (s: string) => Promise<void> } }).clipboard;
    if (c && c.writeText) {
      void c.writeText(t);
      return;
    }
  } catch {
    /* 退回 execCommand */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    /* 忽略 */
  }
}

export function loadGroupMembers(gid: string): void {
  get('/api/groups/members?gid=' + encodeURIComponent(gid))
    .then((j) => {
      if (j && j.ok) state.activeGroupMembers = (j.members as GroupMember[]) || [];
    })
    .catch(() => {
      /* 忽略 */
    });
}

export { asset, clock, fmtSize, tr };

export const chatState = state;
