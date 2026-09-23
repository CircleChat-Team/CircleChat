/* ============================================================
 * CircleChat 前端 — 聊天核心（组合式单例）
 * 封装 WebSocket 连接、REST 调用、消息收发与会话状态。
 * 所有组件 import 同一个实例，状态天然共享。
 * ============================================================ */

import { reactive, ref } from 'vue';
import { asset, get, post, url } from './api';
import { config } from './config';
import { tr } from './i18n';
import { fmtSize } from './format';
import { DEFAULT_NOTIFY_SOUND, isNotifySound, playIncoming, playOutgoing, setNotifySound as soundSetNotify } from './sound';
import type { FileViewTarget } from './fileview';
import { canSystemNotify, systemNotify, shakeWindow } from '../utils/notify';
import { presenceStatusKey, presenceText, type PresencePlatforms, type StatusKey } from './presence';
import type {
  ApiResult,
  ChatMessage,
  ChatUser,
  Friend,
  FriendRequest,
  FriendSent,
  ChatGroup,
  GroupMember,
  ProfileData,
  MergeData,
  MergeItem,
  SearchHit
} from '../types';

/** 搜索范围：room = 当前会话；all = 我的全部会话 */
export type SearchScope = 'room' | 'all';

const PAGE = 30; // 每批渲染 / 加载条数
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB
/** 提示文案里展示的上限，由 MAX_UPLOAD_SIZE 推导，改上限时无需同步改文案 */
const MAX_UPLOAD_LABEL = Math.round(MAX_UPLOAD_SIZE / 1024 / 1024) + 'MB';
const GROUP_GAP_MS = 5 * 60 * 1000; // 同一人 5 分钟内连发视为一组

function clock(ts?: number | null): string {
  const d = new Date(Number(ts) || Date.now());
  const p = (n: number) => (n < 10 ? '0' + n : String(n));
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

function api(path: string): string {
  return url(path);
}

export interface ChatState {
  me: string;
  role: string;
  isAdmin: boolean;
  mustChange: boolean;
  online: string[];
  away: string[];
  /** 在线用户的连接来源：网页端 / 桌面客户端（可能两端都在） */
  platforms: PresencePlatforms;
  /** 用户名 -> 最后在线时间（ms）；离线用户用它显示「最后在线 x」 */
  lastSeen: Record<string, number>;
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
  sendKey: 'enter' | 'ctrl';
  notifySound: string;
  /** 接收消息提示音开关 */
  soundIn: boolean;
  /** 发送消息提示音开关 */
  soundOut: boolean;
  replyTo: ChatMessage | null;
  profileOpen: boolean;
  profile: ProfileData | null;
  myProfileOpen: boolean;
  styleOpen: boolean;
  friendSearchOpen: boolean;
  groupDialogOpen: boolean;
  groupDialogTab: 'create' | 'join' | 'search';
  /** 页面级轻提示（i18n 键或已翻译文本） */
  notice: string;
  /** true = 成功提示（绿色），false = 错误提示（红色） */
  noticeOk: boolean;
  /** 每次提示自增：用于重播动画 / 重置定时器 */
  noticeSeq: number;
  loadingHistory: boolean;
  contextMenu: { idx: number; x: number; y: number } | null;
  selectMode: boolean;
  selected: number[];
  forwardOpen: boolean;
  forwardSource: number[];
  forwardMode: 'single' | 'merge';
  mergeView: MergeData | null;
  imageView: string | null;
  /** 聊天记录搜索面板（会话内 / 全部会话） */
  searchOpen: boolean;
  searchScope: SearchScope;
  searchQuery: string;
  searchLoading: boolean;
  searchHits: SearchHit[];
  searchTotal: number;
  searchError: string;
  /** 文件查看器：文本 / Hex（见 components/chat/FileViewer.vue） */
  fileView: FileViewTarget | null;
  /** 视频模态播放器（消息里只显示预览图，点开才播放） */
  videoView: { src: string; name: string } | null;
  /** 消息里 GitHub 链接的仓库详情弹窗（owner/name；见 components/chat/RepoModal.vue） */
  repoView: string | null;
  /** 媒体播放音量 0~1（音频消息共用；见 components/chat/AudioPlayer.vue） */
  volume: number;
  reactTargetIdx: number | null;
  muted: boolean;
  mutedUntil: number | null;
  lastTs: Record<string, number>;
  unread: Record<string, number>;
  /** 上传任务队列（输入栏上方的进度指示器读取） */
  uploads: UploadTask[];
}

const state = reactive<ChatState>({
  me: '',
  role: 'user',
  isAdmin: false,
  mustChange: false,
  online: [],
  away: [],
  platforms: {},
  lastSeen: {},
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
  sendKey: 'enter',
  notifySound: DEFAULT_NOTIFY_SOUND,
  soundIn: true,
  soundOut: true,
  replyTo: null,
  profileOpen: false,
  profile: null,
  myProfileOpen: false,
  styleOpen: false,
  friendSearchOpen: false,
  groupDialogOpen: false,
  groupDialogTab: 'create',
  notice: '',
  noticeOk: false,
  noticeSeq: 0,
  loadingHistory: false,
  contextMenu: null,
  selectMode: false,
  selected: [],
  forwardOpen: false,
  forwardSource: [],
  forwardMode: 'single',
  mergeView: null,
  imageView: null,
  searchOpen: false,
  searchScope: 'room',
  searchQuery: '',
  searchLoading: false,
  searchHits: [],
  searchTotal: 0,
  searchError: '',
  fileView: null,
  videoView: null,
  repoView: null,
  volume: 1,
  reactTargetIdx: null,
  muted: false,
  mutedUntil: null,
  lastTs: {},
  unread: {},
  uploads: []
});
let noticeTimer: number | undefined;

/** 显示一条页面级轻提示（传 i18n 键或已翻译文本）；ok=true 用成功色，几秒后自动消失 */
export function notify(msg: string, ok = false): void {
  state.notice = msg;
  state.noticeOk = ok;
  state.noticeSeq++;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    state.notice = '';
  }, ok ? 2400 : 3600);
}

export function clearNotice(): void {
  state.notice = '';
  clearTimeout(noticeTimer);
}

/** 自己发出消息的提示音（受设置里的「发送消息提示音」开关控制） */
function playSent(): void {
  if (state.soundOut) playOutgoing();
}

/** 收到他人消息的提示音（受设置里的「接收消息提示音」开关控制） */
function playReceived(): void {
  if (state.soundIn) playIncoming();
}

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let reconnectTimer: number | undefined;
let heartbeatTimer: number | undefined;
let usersReady: Promise<void> | null = null;
let typingSentAt = 0;
let searchSeq = 0; // 搜索请求序号：丢弃过期响应
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
    setConn('on');
    reconnectDelay = 1000;
    clearInterval(heartbeatTimer);
    heartbeatTimer = window.setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 30000);
    loadHistory();
    pushStatus();
  };

  sock.onmessage = (ev: MessageEvent) => {
    let obj: { type?: string; data?: any; from?: string; users?: string[]; away?: string[]; platforms?: PresencePlatforms; lastSeen?: Record<string, number>; by?: string; owner?: string; admin?: boolean; username?: string } | null = null;
    try {
      obj = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    switch (obj.type) {
      case 'msg':
        if (obj.data) {
          // 窗口抖动不走普通通知门禁：它就是用来打断「正在看的会话不打扰」的
          if (obj.data.type === 'shake') handleShake(obj.data);
          bumpRoom(obj.data);
          maybeNotify(obj.data);
          const inRoom = msgInActiveRoom(obj.data);
          if (inRoom) appendMsg(obj.data);
          // 仅他人发来的消息：非当前会话则累加未读，并播提示音
          if (obj.data.from !== state.me) {
            if (!inRoom) addUnread(obj.data);
            playReceived();
          }
        }
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
        state.away = obj.away || [];
        state.platforms = (obj.platforms as PresencePlatforms) || {};
        if (obj.lastSeen) state.lastSeen = { ...state.lastSeen, ...(obj.lastSeen as Record<string, number>) };
        break;
      case 'groups.changed':
        loadGroups();
        break;
      case 'group.members': {
        // 群成员变了（加入 / 退出 / 被移出）：正在看的群就刷新成员列表
        const d = (obj.data || {}) as { gid?: string; name?: string; action?: string };
        const gid = d.gid ? String(d.gid) : '';
        if (!gid) break;
        if (gid === state.activeGid) loadGroupMembers(gid);
        if (d.name === state.me && d.action !== 'join') {
          // 自己被移出（或自己退出）：刷新群列表；还赖在这个群里就撤出去
          loadGroups();
          if (state.activeGid === gid) {
            switchRoom(null);
            notify('chat.group.left');
          }
        }
        break;
      }
      case 'penalty':
        if (obj.data) {
          handlePenalty(obj.data);
        }
        break;
      case 'friends.changed':
        loadFriends();
        break;
      case 'logged.out':
        // 会话已被服务端销毁（如改密）：回到登录页重新登录
        location.replace('/login.html');
        break;
      case 'me.changed':
        // 管理员修改了用户名：刷新页面以更新身份信息
        if (obj.username) location.reload();
        break;
      default:
        break;
    }
  };

  sock.onclose = () => {
    setConn('off');
    clearInterval(heartbeatTimer);
    if (ws !== sock) return;
    // 断线先确认会话还在不在：会话只存在服务端内存里，服务器一重启（每次部署都重启）
    // 就全没了 → 必须回登录页，而不是无限重连、卡在「连接中」不动。
    // 网络抖动时 /api/me 正常返回，照旧继续重连。
    get('/api/me')
      .then((j) => {
        if (!j.ok) location.replace('/login.html');
        else scheduleReconnect();
      })
      .catch(() => scheduleReconnect());
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

// 收到新消息时，将该消息所属会话（群 g:id / 私聊 d:peer）置顶
function bumpRoom(m: ChatMessage): void {
  if (m.gid != null) {
    state.lastTs['g:' + String(m.gid)] = Date.now();
  } else if (m.dm) {
    const peer = String(m.dm).split(':').filter(Boolean).find((n) => n !== state.me);
    if (peer) state.lastTs['d:' + peer] = Date.now();
  }
}

/** 会话键：群 g:id / 私聊 d:peer */
function roomKeyOf(m: ChatMessage): string | null {
  if (m.gid != null) return 'g:' + String(m.gid);
  if (m.dm) {
    const peer = String(m.dm).split(':').filter(Boolean).find((n) => n !== state.me);
    if (peer) return 'd:' + peer;
  }
  return null;
}

/** 非当前会话收到消息时累加未读 */
function addUnread(m: ChatMessage): void {
  const k = roomKeyOf(m);
  if (!k) return;
  state.unread[k] = (state.unread[k] || 0) + 1;
}

/** 进入某会话时清除其未读 */
export function clearUnread(key: string): void {
  if (state.unread[key]) delete state.unread[key];
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

/**
 * 把当前会话写进地址栏（?gid= / ?dm=），刷新后可直接回到同一个会话。
 * 用 replaceState 而不是 pushState：只是让地址栏如实反映当前会话，
 * 不想让"后退"在会话之间来回跳（那需要额外处理 popstate）。
 * 其它查询参数原样保留。
 */
function syncRoomUrl(): void {
  if (typeof history === 'undefined' || !history.replaceState || typeof location === 'undefined') return;
  let url: string;
  try {
    const p = new URLSearchParams(location.search);
    if (state.activeGid != null) {
      p.set('gid', state.activeGid);
      p.delete('dm');
    } else if (state.activeDmPeer != null) {
      p.set('dm', state.activeDmPeer);
      p.delete('gid');
    } else {
      p.delete('gid');
      p.delete('dm');
    }
    const q = p.toString();
    url = location.pathname + (q ? '?' + q : '') + location.hash;
  } catch {
    return; // 环境不支持 URLSearchParams 时静默跳过
  }
  history.replaceState(null, '', url);
}

/** 从地址栏读出要恢复的会话（gid / dm 二选一，都没有则返回空） */
function roomFromUrl(): { gid: string | null; dm: string | null } {
  try {
    const p = new URLSearchParams(location.search);
    return {
      gid: (p.get('gid') || '').trim() || null,
      dm: (p.get('dm') || '').trim() || null
    };
  } catch {
    return { gid: null, dm: null };
  }
}

export function switchRoom(gid: string | null): void {
  state.activeGid = gid == null ? null : String(gid);
  state.activeDmPeer = null;
  state.replyTo = null;
  state.activeGroupMembers = [];
  if (gid != null) clearUnread('g:' + String(gid));
  resetRoom();
  syncRoomUrl();
  if (gid != null) loadGroupMembers(gid);
  loadHistory();
}

export function switchRoomToDm(peer: string): void {
  const p = String(peer || '');
  if (!p || p === state.me) return;
  state.activeDmPeer = p;
  state.activeGid = null;
  state.replyTo = null;
  clearUnread('d:' + p);
  resetRoom();
  syncRoomUrl();
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
    state.mustChange = !!j.mustChange;
    state.online = (j.online as string[]) || [];
    state.away = (j.away as string[]) || [];
    state.platforms = (j.platforms as PresencePlatforms) || {};
    if (j.lastSeen) state.lastSeen = j.lastSeen as Record<string, number>;
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
            if (u.lastSeen) state.lastSeen[u.name] = Number(u.lastSeen);
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
      state.myFriends.forEach((f) => {
        if (f.lastSeen) state.lastSeen[f.name] = Number(f.lastSeen);
      });
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
      // 被移除/退出群后：若当前所在群已不在我的群列表，自动返回首页（首个群或空状态）
      if (state.activeGid != null && !state.myGroups.some((g) => String(g.id) === String(state.activeGid))) {
        switchRoom(state.myGroups.length ? state.myGroups[0].id : null);
      }
    })
    .catch(() => {
      /* 忽略 */
    });
}

// ---------------- 发送 ----------------

export function sendText(text: string, md?: boolean): void {
  const val = (text || '').trim();
  if (!val) return;
  // 非好友私聊不允许带引用：给出提示，但保留已输入内容（原实现会静默吞掉并清空引用）
  if (dmgating() && state.replyTo) {
    notify('chat.dm.gateToast');
    return;
  }
  const data: Record<string, unknown> = { type: 'text', content: val };
  if (md) data.md = 1;
  if (state.activeGid != null) data.gid = state.activeGid;
  if (state.activeDmPeer != null) data.pm = state.activeDmPeer;
  if (state.replyTo && state.replyTo.idx != null) data.replyTo = state.replyTo.idx;
  if (!send({ type: 'msg', data })) return;
  playSent();
  state.replyTo = null;
}

/** 「窗口抖动」本地冷却：服务端另有一道更短的防线（见 runtime.ts 的 SHAKE_COOLDOWN_MS） */
const SHAKE_COOLDOWN_MS = 10 * 1000;
let lastShakeAt = 0;

/** 当前是否可以抖动：私聊 + 对方有桌面客户端在线 */
export function canShake(): boolean {
  const peer = state.activeDmPeer;
  return !!peer && isClientOnline(peer);
}

/**
 * 给当前私聊对象发一个「窗口抖动」。
 * 抖动是客户端能力，对方只在网页端时没有效果，所以先判客户端在线；
 * 群里不做（一次会惊动所有人）。真正让窗口抖动的是收到消息的那一端。
 */
export function sendShake(): void {
  const peer = state.activeDmPeer;
  if (!peer) return;
  if (!isClientOnline(peer)) {
    notify('chat.shake.notClient');
    return;
  }
  const now = Date.now();
  if (now - lastShakeAt < SHAKE_COOLDOWN_MS) {
    notify('chat.shake.tooOften');
    return;
  }
  if (!send({ type: 'msg', data: { type: 'shake', content: '', pm: peer } })) return;
  lastShakeAt = now;
  playSent();
}

/** 收到「窗口抖动」：抖一下——这是提醒手段，不受「正在看的会话」门禁限制 */
function handleShake(m: ChatMessage): void {
  if (m.from === state.me) return; // 自己那条会被服务端广播回来，别重复抖
  void shakeWindow();
}

/** 单个上传任务（输入栏上方的上传指示器读取） */
export interface UploadTask {
  id: number;
  /** 文件名（粘贴的截图没有名字时自动生成） */
  name: string;
  kind: 'image' | 'file';
  size: number;
  /** 已上传字节数（用于显示「12.3 MB / 45.0 MB」） */
  loaded: number;
  /** 0-100 */
  percent: number;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  /** 失败原因（i18n 键或直译文案），成功后清空 */
  error: string;
  /** 是否可重试：前置校验失败（超大 / 私聊受限）的任务没有文件可重传 */
  retryable: boolean;
  /** 实时上传速度（字节/秒）；未在传输中时为 0 */
  speed: number;
  /** 图片缩略图（本地 object URL，仅用于上传面板预览；移除任务时需 revoke） */
  thumbUrl?: string;
  /** 分片总数（仅分片上传的大文件有；用于面板显示「已传/总片数」） */
  chunks?: number;
  /** 已确认到达服务端的分片数 */
  chunkDone?: number;
  /** 每片进度（0-100；仅分片上传时用于渲染 IDM 式分段进度条）。
   *  每个分片进度事件都会写入，保证分段标记实时刷新。 */
  chunkProgress?: number[];
}

/** 分片上传会话：记录服务端 uploadId 与每片的进度，用于续传与聚合进度 */
interface ChunkSession {
  /** 服务端会话 id；首次上传前为空串 */
  uploadId: string;
  /** 分片总数 */
  chunks: number;
  /** 每片当前已传字节数（在途/已确认），用于聚合出 task.loaded */
  loaded: number[];
  /** 每片是否已被服务端确认 */
  done: boolean[];
}

let uploadSeq = 0;
/** 同时进行的上传数：全串行太慢、全并行又挤带宽，取 3 作折中 */
const MAX_CONCURRENT_UPLOADS = 3;
/** 分片大小（必须与服务端 server/lib/runtime.ts 的 CHUNK_SIZE 一致） */
const CHUNK_SIZE = 5 * 1024 * 1024;
/** 单个文件同时并发的分片数 */
const MAX_CONCURRENT_CHUNKS = 10;
/** 任务 id → 待上传文件；不放进响应式状态，避免 Vue 代理 DOM 对象 */
const pendingFiles = new Map<number, File>();
/** 任务 id → 速度采样（非响应式，避免每个进度事件都额外渲染一次） */
const speedTrack = new Map<number, { loaded: number; ts: number; ema: number }>();
/** 任务 id → 进行中的 XHR 集合（分片上传时一个任务会有多个并发请求） */
const uploadXhr = new Map<number, Set<XMLHttpRequest>>();
/** 任务 id → 分片会话（uploadId / 各片进度）；大文件才建，用于断点续传 */
const sessions = new Map<number, ChunkSession>();
/** 排队等待调度的任务 id（FIFO） */
const waitQueue: number[] = [];
/** 当前正在上传的任务数（受 MAX_CONCURRENT_UPLOADS 限制） */
let runningUploads = 0;
/**
 * 还没发出消息的任务 id。并发上传会打乱完成顺序，这里先把成功结果攒在
 * readyResults 里，按 id 升序发送，保证消息顺序与用户选择顺序一致。
 */
const unsentIds = new Set<number>();
/** 任务 id → 已上传成功、等待按序发送的结果 */
const readyResults = new Map<number, { kind: string; url: string; name: string; size: number }>();

function newTask(file: File, gating: boolean): UploadTask {
  const kind: 'image' | 'file' = /^image\//.test(file.type || '') ? 'image' : 'file';
  const name =
    file.name ||
    (kind === 'image'
      ? tr('chat.upload.shotPrefix') + Date.now() + '.' + (file.type.split('/')[1] || 'png')
      : tr('chat.file.defaultName'));
  let error = '';
  if (gating && kind !== 'image') error = tr('chat.dm.gateToast');
  else if (file.size > MAX_UPLOAD_SIZE) error = tr('chat.upload.tooBig', { name, max: MAX_UPLOAD_LABEL });
  return {
    id: ++uploadSeq,
    name,
    kind,
    size: file.size,
    loaded: 0,
    percent: 0,
    status: error ? 'failed' : 'queued',
    error,
    retryable: !error,
    speed: 0
  };
}

function taskById(id: number): UploadTask | undefined {
  return state.uploads.find((t) => t.id === id);
}

/** 通过 state 里的响应式代理改字段，保证视图更新 */
function patchTask(id: number, patch: Partial<UploadTask>): void {
  const t = taskById(id);
  if (t) Object.assign(t, patch);
}

/** 把一个 XHR 登记到某任务下（分片上传时同一任务有多个并发请求）；返回注销函数 */
function trackXhr(id: number, xhr: XMLHttpRequest): () => void {
  let set = uploadXhr.get(id);
  if (!set) {
    set = new Set<XMLHttpRequest>();
    uploadXhr.set(id, set);
  }
  set.add(xhr);
  return (): void => {
    const s = uploadXhr.get(id);
    if (!s) return;
    s.delete(xhr);
    if (!s.size) uploadXhr.delete(id);
  };
}

/** 超时按体积估算：固定值对大文件必然超时（看起来就像传到一半卡住）。下限 2 分钟，上限 30 分钟 */
function uploadTimeout(bytes: number): number {
  return Math.min(30 * 60 * 1000, Math.max(120000, Math.round((bytes / (50 * 1024)) * 1000)));
}

interface XhrResult {
  status: number;
  body: ApiResult;
}

/**
 * 用 XHR 发一次 POST。
 * 用 XHR 而非 fetch：只有 XHR 能拿到上传进度事件，也只有它能被中断（取消上传 / 分片失败时掐断其他在途片）。
 */
function postForm(
  id: number,
  url: string,
  form: FormData,
  onProgress?: (loaded: number, total: number) => void,
  timeoutMs?: number
): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const untrack = trackXhr(id, xhr);
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    if (timeoutMs) xhr.timeout = timeoutMs;
    if (onProgress) {
      xhr.upload.onprogress = (e: ProgressEvent): void => {
        if (e.lengthComputable && e.total) onProgress(e.loaded, e.total);
      };
    }
    xhr.onload = (): void => {
      untrack();
      let body: ApiResult = { ok: false };
      try {
        body = JSON.parse(xhr.responseText || '{}') as ApiResult;
      } catch {
        body = { ok: false };
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = (): void => { untrack(); reject(new Error('network')); };
    xhr.ontimeout = (): void => { untrack(); reject(new Error('timeout')); };
    xhr.onabort = (): void => { untrack(); reject(new Error('abort')); };
    xhr.send(form);
  });
}

/** 速度采样：进度事件很密，按 ≥200ms 采样 + 指数平均平滑，避免数字乱跳 */
function sampleSpeed(id: number, loaded: number): number {
  const st = speedTrack.get(id);
  if (!st) return 0;
  const now = performance.now();
  if (!st.ts) {
    st.ts = now;
    st.loaded = loaded;
    return 0;
  }
  if (now - st.ts >= 200) {
    const inst = (loaded - st.loaded) / ((now - st.ts) / 1000);
    st.ema = st.ema > 0 ? st.ema * 0.6 + inst * 0.4 : inst;
    st.loaded = loaded;
    st.ts = now;
  }
  return Math.max(0, st.ema);
}

/** 小文件单次上传（≤ CHUNK_SIZE） */
function postUpload(id: number, file: File, onProgress: (loaded: number, total: number) => void): Promise<ApiResult> {
  const fd = new FormData();
  fd.append('file', file);
  return postForm(id, api('/api/upload'), fd, onProgress, uploadTimeout(file.size)).then((r) => {
    if (r.status < 200 || r.status >= 300) throw new Error('http ' + r.status);
    return r.body;
  });
}

/** 中断某个任务所有在途请求（分片失败时立刻掐断同任务的其它分片，不再空耗带宽） */
function abortInFlight(id: number): void {
  const set = uploadXhr.get(id);
  if (!set) return;
  for (const xhr of Array.from(set)) {
    try { xhr.abort(); } catch { /* 忽略 */ }
  }
}

/**
 * 分片 sha256（十六进制小写）。
 * 服务端会拿它逐片比对，能挡住「长度正好没变」的传输损坏。
 * 非安全上下文 / 老浏览器没有 crypto.subtle 时返回空串 —— 服务端会跳过这项校验，
 * 不影响上传（只是少了这道保险）。
 */
async function sha256Hex(blob: Blob): Promise<string> {
  const subtle = (crypto as Crypto & { subtle?: SubtleCrypto }).subtle;
  if (!subtle || !subtle.digest) return '';
  try {
    const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return ''; // 计算失败就退化为不校验，不因此让上传失败
  }
}

/** 上传单个分片；resolve 表示服务端已确认收到该片 */
async function uploadChunk(id: number, file: File, sess: ChunkSession, index: number): Promise<void> {
  const start = index * CHUNK_SIZE;
  const end = Math.min(file.size, start + CHUNK_SIZE);
  const blob = file.slice(start, end);
  const sha = await sha256Hex(blob);
  if (!taskById(id)) throw new Error('abort'); // 校验期间被取消
  const fd = new FormData();
  fd.append('file', blob, 'chunk');
  const url = api('/api/upload/chunk?uploadId=' + encodeURIComponent(sess.uploadId)
    + '&index=' + index + (sha ? '&sha=' + sha : ''));
  const r = await postForm(id, url, fd, (loaded) => {
    sess.loaded[index] = loaded;
    syncChunkProgress(id, sess);
  }, uploadTimeout(end - start));
  if (r.status < 200 || r.status >= 300 || !r.body.ok) {
    throw new Error('chunk ' + index + ' http ' + r.status);
  }
  sess.loaded[index] = end - start; // 以服务端确认的片大小为准，避免最后一片多算
  sess.done[index] = true;
  syncChunkProgress(id, sess);
}

/** 把各片进度聚合到任务上（已传字节 / 百分比 / 速度 / 已传片数） */
function syncChunkProgress(id: number, sess: ChunkSession): void {
  const t = taskById(id);
  if (!t) return;
  let sum = 0;
  let done = 0;
  for (let i = 0; i < sess.chunks; i++) {
    sum += sess.loaded[i] || 0;
    if (sess.done[i]) done++;
  }
  const loaded = Math.min(t.size, sum);
  // 每片进度：已确认的记为 100，在途的按该片实际字节折算（0-99），供 IDM 式分段条渲染
  const cp: number[] = [];
  for (let i = 0; i < sess.chunks; i++) {
    if (sess.done[i]) cp.push(100);
    else {
      const cs = chunkSizeAt(t.size, i, sess.chunks);
      cp.push(cs ? Math.min(99, Math.round(((sess.loaded[i] || 0) / cs) * 100)) : 0);
    }
  }
  patchTask(id, {
    loaded,
    percent: t.size ? Math.min(99, Math.round((loaded / t.size) * 100)) : 0,
    speed: sampleSpeed(id, loaded),
    chunks: sess.chunks,
    chunkDone: done,
    chunkProgress: cp
  });
}

/** 并发池：最多 limit 个 worker 同时跑；任一片出错即停止派发新的片，等在途的收尾后统一抛出 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let firstError: unknown = null;
  const run = async (): Promise<void> => {
    while (!firstError) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await worker(items[i]);
      } catch (e) {
        if (!firstError) firstError = e;
        return;
      }
    }
  };
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(run());
  await Promise.all(runners);
  if (firstError) throw firstError;
}

/** 取（必要时创建）任务的分片会话 */
function ensureSession(id: number, file: File): ChunkSession {
  let s = sessions.get(id);
  if (!s) {
    const chunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    s = {
      uploadId: '',
      chunks,
      loaded: new Array<number>(chunks).fill(0),
      done: new Array<boolean>(chunks).fill(false)
    };
    sessions.set(id, s);
  }
  return s;
}

/** 第 index 片应有的字节数（最后一片可能不足 CHUNK_SIZE） */
function chunkSizeAt(size: number, index: number, chunks: number): number {
  return index === chunks - 1 ? size - index * CHUNK_SIZE : CHUNK_SIZE;
}

function failUpload(id: number, error: string): void {
  // 任务已被取消/移除时不要再弹提示、也不要把状态盖回去
  if (!taskById(id)) return;
  notify(error);
  unsentIds.delete(id);
  readyResults.delete(id);
  patchTask(id, { status: 'failed', error: tr(error), retryable: pendingFiles.has(id), speed: 0 });
  flushReady(); // 失败的排队任务不再阻塞后面已完成的任务
}

/** 按 id 升序把已上传成功的任务发出去；最早的那个还没就绪就先等（避免并发导致消息乱序） */
function flushReady(): void {
  for (;;) {
    let min = Infinity;
    for (const id of unsentIds) if (id < min) min = id;
    if (min === Infinity) return;
    const r = readyResults.get(min);
    if (!r) return;
    unsentIds.delete(min);
    readyResults.delete(min);
    dispatchUpload(min, r);
  }
}

/** 上传成功后组装并发送消息；发送后短暂停留再收起进度条 */
function dispatchUpload(id: number, r: { kind: string; url: string; name: string; size: number }): void {
  const t = taskById(id);
  if (!t) return;
  patchTask(id, { percent: 100, loaded: t.size, status: 'done', retryable: false, speed: 0 });
  pendingFiles.delete(id);
  const data: Record<string, unknown> = { type: r.kind, content: r.url, name: r.name, size: r.size };
  if (state.activeGid != null) data.gid = state.activeGid;
  if (state.activeDmPeer != null) data.pm = state.activeDmPeer;
  if (send({ type: 'msg', data })) playSent();
  // 让「已发送」停留一下再收起，避免进度条一闪而过
  window.setTimeout(() => dismissUpload(id), 1200);
}

/** 从排队队列取任务开跑，直到用满并发数；每个任务结束后再补位 */
function pumpQueue(): void {
  while (runningUploads < MAX_CONCURRENT_UPLOADS && waitQueue.length) {
    const id = waitQueue.shift() as number;
    if (!pendingFiles.has(id) || !taskById(id)) continue; // 已被取消 / 已移除
    runningUploads++;
    void runUpload(id).finally(() => {
      runningUploads--;
      pumpQueue();
    });
  }
}

/** 上传结果统一收口：私聊门禁复核 → 攒进 readyResults → 按序发送 */
function acceptResult(id: number, r: { kind: string; url: string; name: string; size: number }): void {
  if (!taskById(id)) return; // 上传途中被取消：丢弃结果，不再发消息
  if (dmgating() && r.kind !== 'image') {
    failUpload(id, 'chat.dm.gateToast');
    return;
  }
  readyResults.set(id, r);
  sessions.delete(id);
  flushReady();
}

/** 小文件：单次 POST /api/upload */
async function runUploadSingle(id: number, file: File): Promise<void> {
  const body = await postUpload(id, file, (loaded, total) => {
    // 留 1%：等服务器写盘并返回后才算完成
    patchTask(id, {
      percent: Math.min(99, Math.round((loaded / total) * 100)),
      loaded,
      speed: sampleSpeed(id, loaded)
    });
  });
  if (!body.ok) {
    failUpload(id, String(body.error || 'chat.upload.failed'));
    return;
  }
  acceptResult(id, {
    kind: String(body.kind),
    url: String(body.url),
    name: String(body.name),
    size: Number(body.size)
  });
}

/**
 * 大文件：分片上传。
 * init（带旧 uploadId 即可续传）→ 并发补传缺失分片 → complete 合并。
 * 任一步失败都保留会话，重试时只补传缺失的分片。
 */
async function runUploadChunked(id: number, file: File, sess: ChunkSession): Promise<void> {
  const task = taskById(id);
  const init = await post('/api/upload/init', {
    name: task ? task.name : file.name,
    size: file.size,
    uploadId: sess.uploadId
  });
  if (!taskById(id)) return; // init 期间被取消
  if (!init.ok || !init.uploadId) {
    failUpload(id, String(init.error || 'chat.upload.retry'));
    return;
  }
  sess.uploadId = String(init.uploadId);
  sess.chunks = Number(init.chunks) || sess.chunks;
  if (sess.loaded.length !== sess.chunks) {
    sess.loaded = new Array<number>(sess.chunks).fill(0);
    sess.done = new Array<boolean>(sess.chunks).fill(false);
  }
  // 服务端已确认的分片直接算完成（断线/刷新后续传的关键）
  const received = Array.isArray(init.received) ? (init.received as number[]) : [];
  for (let i = 0; i < sess.chunks; i++) {
    if (received.indexOf(i) !== -1) {
      sess.done[i] = true;
      sess.loaded[i] = chunkSizeAt(file.size, i, sess.chunks);
    } else if (!sess.done[i]) {
      sess.loaded[i] = 0;
    }
  }
  syncChunkProgress(id, sess);

  // 只补传缺失的分片，最多 MAX_CONCURRENT_CHUNKS 片同时在传
  const todo: number[] = [];
  for (let i = 0; i < sess.chunks; i++) if (!sess.done[i]) todo.push(i);
  await runPool(todo, MAX_CONCURRENT_CHUNKS, async (i) => {
    // 期间被取消就不再派发新分片（抛 abort 让上层静默收口）
    if (!taskById(id)) throw new Error('abort');
    try {
      await uploadChunk(id, file, sess, i);
    } catch (e) {
      // 任一片失败：先掐断同任务的其它在途分片（反正半截的片不会被服务端记账，
      // 白传完也没用），再抛出 → runPool 停止派发新片
      abortInFlight(id);
      throw e;
    }
  });

  if (!taskById(id)) return; // 取消后不必再去 complete
  const done = await post('/api/upload/complete', { uploadId: sess.uploadId });
  if (!done.ok) {
    // 会话在服务端已失效（过期/被清理）：清空 uploadId，下次重试会重新开一个会话
    if (String(done.error) === 'api.upload.sessionGone') sess.uploadId = '';
    failUpload(id, String(done.error || 'chat.upload.retry'));
    return;
  }
  acceptResult(id, {
    kind: String(done.kind),
    url: String(done.url),
    name: String(done.name),
    size: Number(done.size)
  });
}

async function runUpload(id: number): Promise<void> {
  const file = pendingFiles.get(id);
  if (!file || !taskById(id)) return;
  speedTrack.set(id, { loaded: 0, ts: 0, ema: 0 });
  patchTask(id, { status: 'uploading', percent: 0, loaded: 0, error: '', speed: 0 });
  try {
    // 超过一片的文件走分片上传（可并发、可续传）；小文件走单次上传，省掉两次往返
    if (file.size > CHUNK_SIZE) await runUploadChunked(id, file, ensureSession(id, file));
    else await runUploadSingle(id, file);
  } catch (e) {
    // 用户主动取消：任务已移除，不当作失败（否则会弹一条"上传失败"）
    if (e instanceof Error && e.message === 'abort') return;
    failUpload(id, 'chat.upload.retry');
  }
}

/** 取消上传：中断该任务所有在途请求（含并发的分片）并从队列移除 */
export function cancelUpload(id: number): void {
  abortInFlight(id);
  uploadXhr.delete(id);
  // 分片会话：通知服务端清掉已上传的分片（失败也不影响本地移除）
  const sess = sessions.get(id);
  if (sess && sess.uploadId) void post('/api/upload/abort', { uploadId: sess.uploadId });
  sessions.delete(id);
  dismissUpload(id);
}

export function uploadFiles(files: FileList | File[]): void {
  const gating = dmgating();
  for (const f of Array.from(files)) {
    const t = newTask(f, gating);
    state.uploads.push(t);
    // 前置校验不通过（超大 / 私聊受限）的直接标红，不进队列
    if (t.status !== 'queued') continue;
    if (t.kind === 'image' && /^image\//.test(f.type || '')) {
      try { t.thumbUrl = URL.createObjectURL(f); } catch { /* 忽略（不支持时退化为图标） */ }
    }
    pendingFiles.set(t.id, f);
    unsentIds.add(t.id);
    waitQueue.push(t.id);
  }
  pumpQueue(); // 最多同时传 MAX_CONCURRENT_UPLOADS 个，其余排队等待
}

/** 重试失败的上传（前置校验失败的没有文件可重传，只能关闭） */
export function retryUpload(id: number): void {
  const t = taskById(id);
  if (!t || t.status !== 'failed' || !pendingFiles.has(id)) return;
  patchTask(id, { status: 'queued', percent: 0, error: '', retryable: true, speed: 0 });
  unsentIds.add(id);
  waitQueue.push(id);
  pumpQueue();
}

/** 一键重试所有可重试的失败任务 */
export function retryAllFailed(): void {
  for (const t of [...state.uploads]) {
    if (t.status === 'failed' && t.retryable) retryUpload(t.id);
  }
}

/** 关闭（移除）一条上传任务 */
export function dismissUpload(id: number): void {
  const i = state.uploads.findIndex((t) => t.id === id);
  if (i >= 0) {
    const t = state.uploads[i];
    if (t.thumbUrl) {
      try { URL.revokeObjectURL(t.thumbUrl); } catch { /* 忽略 */ }
    }
    state.uploads.splice(i, 1);
  }
  const qi = waitQueue.indexOf(id);
  if (qi >= 0) waitQueue.splice(qi, 1);
  pendingFiles.delete(id);
  speedTrack.delete(id);
  uploadXhr.delete(id);
  sessions.delete(id);
  unsentIds.delete(id);
  readyResults.delete(id);
  flushReady(); // 移除可能让后面已完成的任务不再被阻塞
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

/** 打开「合并转发」查看模态框 */
export function openMergeView(idx: number): void {
  const m = state.messages.find((x) => x.idx === idx);
  if (!m || m.type !== 'merge') return;
  try {
    const o = JSON.parse(m.content || '');
    if (o && Array.isArray(o.items)) state.mergeView = { title: o.title || '', items: o.items as MergeItem[] };
  } catch {
    /* 忽略非法内容 */
  }
}

export function closeMergeView(): void {
  state.mergeView = null;
}

/** 打开图片灯箱查看 */
export function openImageView(src: string): void {
  if (src) state.imageView = src;
}
export function closeImageView(): void {
  state.imageView = null;
}

/** 打开视频模态播放器（消息里只放预览图，避免在气泡里挤一个小播放器） */
export function openVideoView(src: string, name?: string | null): void {
  if (src) state.videoView = { src, name: String(name || '') };
}
export function closeVideoView(): void {
  state.videoView = null;
}

/**
 * 打开文件查看器（文本 / Hex）。
 * 这里只带「地址 + 名字 + 体积」，具体读文件头判断类型交给查看器组件——
 * 判断要看真实内容，不能靠后缀名。
 */
export function openFileView(url: string, name?: string | null, size?: number | null): void {
  if (!url) return;
  state.fileView = { url, name: String(name || ''), size: Number(size || 0) };
}
export function closeFileView(): void {
  state.fileView = null;
}

/** 打开 GitHub 仓库详情弹窗（卡片上的「展开详细信息」） */
export function openRepoView(full: string): void {
  const f = String(full || '').trim();
  if (f) state.repoView = f;
}
export function closeRepoView(): void {
  state.repoView = null;
}

// ---------------- 媒体播放音量 ----------------

/** 上一次的非零音量：拖动到 0（静音）后再点喇叭能回到原来的大小，而不是直接满音量 */
let lastVolume = 1;
let volumeSaveTimer: number | undefined;

/**
 * 设置媒体播放音量（0~1）。
 * 拖动滑块会连续调用，所以写库做了 500ms 防抖 —— 松手后只落一次设置。
 */
export function setVolume(v: number): void {
  const n = Math.min(1, Math.max(0, Number(v) || 0));
  state.volume = Math.round(n * 100) / 100;
  if (state.volume > 0) lastVolume = state.volume;
  clearTimeout(volumeSaveTimer);
  volumeSaveTimer = window.setTimeout(() => {
    void post('/api/settings', { volume: state.volume }).catch(() => {
      /* 存不上不影响本次播放 */
    });
  }, 500);
}

/** 喇叭按钮的静音切换：0 ⇄ 上次的音量 */
export function toggleMuteVolume(): void {
  setVolume(state.volume > 0 ? 0 : lastVolume || 1);
}

/** 复制图片到剪贴板（失败返回 false，调用方可回退为复制地址） */
export async function copyImage(src: string): Promise<boolean> {
  try {
    const res = await fetch(src, { credentials: 'same-origin' });
    const blob = await res.blob();
    const type = blob.type || 'image/png';
    const w = window as unknown as { ClipboardItem?: new (items: Record<string, Blob>) => unknown };
    const cb = (navigator as unknown as { clipboard?: { write?: (items: unknown[]) => Promise<void> } }).clipboard;
    if (w.ClipboardItem && cb && cb.write) {
      await cb.write([new w.ClipboardItem({ [type]: blob })]);
      return true;
    }
  } catch {
    /* 忽略，调用方回退为复制地址 */
  }
  return false;
}

function findMsg(idx: number): ChatMessage | undefined {
  return state.messages.find((m) => m.idx === idx);
}

/** 转发：逐条 = 每条各自发送；合并 = 打包成一条 merge 消息（客户端以模态框展示）。target 形如 { gid } 或 { pm } */
export function forwardTo(target: { gid?: string; pm?: string }): void {
  const msgs = (state.forwardSource || []).map(findMsg).filter((m): m is ChatMessage => !!m);
  if (!msgs.length) return;
  const merge = state.forwardMode === 'merge';
  if (merge) {
    const items: MergeItem[] = msgs.map((m) => {
      const isMedia = m.type === 'image' || m.type === 'file' || m.type === 'video' || m.type === 'audio';
      // 合并转发里不嵌套合并转发本身：content 是结构化 JSON，直接展示会是一坨原文
      const content = m.type === 'merge' ? tr('chat.merge.label') : (m.content || '');
      const it: MergeItem = {
        from: m.from || '?',
        type: isMedia ? (m.type as 'image' | 'file' | 'video' | 'audio') : 'text',
        content
      };
      if (isMedia) { it.name = m.name || null; it.size = m.size != null ? m.size : null; }
      return it;
    });
    const content = JSON.stringify({ title: tr('chat.merge.defaultTitle'), items });
    send({ type: 'msg', data: { type: 'merge', content, ...target } });
  } else {
    for (const m of msgs) {
      const data: Record<string, unknown> = { type: m.type, content: m.content };
      if (m.type !== 'text') {
        data.name = m.name;
        data.size = m.size;
      } else if (m.md) {
        data.md = 1;
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
  return get('/api/profile?name=' + encodeURIComponent(name))
    .then((j) => {
      if (j.ok) state.profile = j as unknown as ProfileData;
      else notify(String(j.error || 'common.opFailed')); // 原实现失败时毫无反馈
    })
    .catch(() => {
      notify('common.opFailedRetry');
    });
}

export function closeProfile(): void {
  state.profileOpen = false;
  state.profile = null;
}

export function openMyProfile(): void {
  state.myProfileOpen = true;
}
export function openStyle(): void {
  state.styleOpen = true;
}
export function closeStyle(): void {
  state.styleOpen = false;
}
export function closeMyProfile(): void {
  state.myProfileOpen = false;
}

// ---------------- 个人资料编辑（本人：改名 / 头像 / 两步验证） ----------------

export function updateProfileName(name: string): Promise<{ ok: boolean; error?: string; newName?: string }> {
  return post('/api/profile', { name });
}

/** 上传图片作为头像并更新本人资料；成功返回 true */
export async function updateAvatar(file: File): Promise<boolean> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(api('/api/upload'), { method: 'POST', body: fd, credentials: 'same-origin' });
  const body = await res.json();
  if (!body.ok || body.kind !== 'image') {
    notify(String(body.error || 'chat.upload.failed'));
    return false;
  }
  const j = await post('/api/profile', { image: body.url });
  if (j && j.ok) {
    state.userImages[state.me] = body.url;
    const u = state.allUsers.find((x) => x.name === state.me);
    if (u) u.image = body.url;
  }
  return !!(j && j.ok);
}

/** 清除本人头像 */
export function clearAvatar(): Promise<boolean> {
  return post('/api/profile', { image: '' }).then((j) => {
    if (j && j.ok) {
      state.userImages[state.me] = null;
      const u = state.allUsers.find((x) => x.name === state.me);
      if (u) u.image = null;
    }
    return !!(j && j.ok);
  });
}

export function twofaSetup(): Promise<{ ok: boolean; secret?: string; otpauth?: string; error?: string }> {
  return post('/api/twofa/setup', {});
}
export function twofaEnable(code: string): Promise<{ ok: boolean; error?: string }> {
  return post('/api/twofa/enable', { code });
}
export function twofaDisable(code: string): Promise<{ ok: boolean; error?: string }> {
  return post('/api/twofa/disable', { code });
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

export function groupCreate(name: string): Promise<string | null> {
  return post('/api/groups', { name }).then((j) => {
    loadGroups();
    return j && j.ok && j.id ? String(j.id) : null;
  });
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

/** 设置/清除群头像（群主或管理员）；avatar 传空串清除 */
export function groupSetAvatar(gid: string, avatar: string): Promise<void> {
  return post('/api/groups/avatar', { gid, avatar }).then(() => loadGroups());
}

/** 举报一条消息（按 idx）。返回 {ok} 或抛错（由调用方提示）。 */
export function reportMessage(idx: number, reason: string): Promise<boolean> {
  return post('/api/report', { idx, reason }).then((j) => !!j.ok);
}

/** 处理服务端下发“处罚”事件：被禁言时客户端停止发送；被封禁则退出登录。 */
function handlePenalty(data: any): void {
  state.muted = !!data.muted;
  state.mutedUntil = typeof data.mutedUntil === 'number' ? data.mutedUntil : null;
  if (data.banned) {
    logout();
    return;
  }
}

export async function saveSettings(patch: Record<string, unknown>): Promise<void> {
  await post('/api/settings', patch);
  if (typeof patch.notify === 'boolean') state.notifyOn = patch.notify;
  if (patch.sendKey === 'enter' || patch.sendKey === 'ctrl') state.sendKey = patch.sendKey;
  if (typeof patch.notifySound === 'string' && isNotifySound(patch.notifySound)) {
    state.notifySound = patch.notifySound;
    soundSetNotify(patch.notifySound);
  }
  if (typeof patch.soundIn === 'boolean') state.soundIn = patch.soundIn;
  if (typeof patch.soundOut === 'boolean') state.soundOut = patch.soundOut;
}

/** 发送按键模式：enter=Enter 发送 / Ctrl+Enter 换行；ctrl=Ctrl+Enter 发送 / Enter 换行 */
export function setSendKey(mode: 'enter' | 'ctrl'): void {
  state.sendKey = mode === 'ctrl' ? 'ctrl' : 'enter';
  void post('/api/settings', { sendKey: state.sendKey }).catch(() => {
    /* 忽略 */
  });
}

/** 消息提示音：切换并保存（试听由调用方触发） */
export function setNotifySound(file: string): void {
  if (!isNotifySound(file)) return;
  state.notifySound = file;
  soundSetNotify(file);
  void post('/api/settings', { notifySound: file }).catch(() => {
    /* 忽略 */
  });
}

/** 接收消息提示音开关（试听由调用方触发） */
export function setSoundIn(on: boolean): void {
  state.soundIn = !!on;
  void post('/api/settings', { soundIn: state.soundIn }).catch(() => {
    /* 忽略 */
  });
}

/** 发送消息提示音开关（试听由调用方触发） */
export function setSoundOut(on: boolean): void {
  state.soundOut = !!on;
  void post('/api/settings', { soundOut: state.soundOut }).catch(() => {
    /* 忽略 */
  });
}

/**
 * 开启/关闭系统通知。
 * 通知只由桌面客户端提供（页面 → window.__CIRCLECHAT__.notify → 客户端 IPC），
 * 网页端没有这个能力，开启会直接保持关闭。UI 上对应开关也是禁用的。
 */
export async function setNotify(enabled: boolean): Promise<boolean> {
  const on = enabled && canSystemNotify();
  state.notifyOn = on;
  void post('/api/settings', { notify: on }).catch(() => {
    /* 忽略 */
  });
  return on;
}

/** 新消息到达：不在当前会话 或 页面隐藏 时，通过桌面客户端弹系统通知 */
export function maybeNotify(m: ChatMessage): void {
  if (m.type === 'shake') return; // 抖动本身就是提醒，再发条空正文的系统通知没意义
  if (!state.notifyOn) return;
  if (!canSystemNotify()) return; // 网页端没有系统通知能力
  if (msgInActiveRoom(m) && !document.hidden) return; // 正在看的会话不打扰
  let room = '';
  let title = m.from || '';
  if (m.gid != null) {
    const g = state.myGroups.find((x) => x.id === m.gid);
    room = g ? g.name : '';
  } else if (m.dm != null) {
    const peer = m.dm.split(':').find((u) => u !== state.me);
    room = peer || '';
    title = title || peer || '';
  }
  if (!title) title = room || 'CircleChat';
  const body = m.type === 'image' ? tr('chat.notify.body.image')
    : m.type === 'video' ? tr('chat.notify.body.video')
    : m.type === 'audio' ? tr('chat.notify.body.audio')
    : m.type === 'file' ? tr('chat.notify.body.file')
    : m.type === 'merge' ? tr('chat.notify.body.merge')
    : String(m.content || '');
  // 交给客户端弹系统通知；失败（系统通知服务不可用 / 权限被拒 / 超时）时静默跳过，
  // 不额外打扰用户——提示音与未读红点已经足够。
  void systemNotify(title, body.slice(0, 200));
  // 同时让客户端窗口抖一下：通知可能被系统免打扰吃掉，窗口抖动更能吸引注意。
  // 纯浏览器 / 老客户端没有这个能力，会返回 { done: false }，不影响上面逻辑。
  void shakeWindow();
}

/** 第三方登录相关的结果码（?oauth=xxx）；未知码一律按「失败」提示 */
const OAUTH_ERR_CODES = ['notconfigured', 'state', 'denied', 'failed', 'nobind', 'taken', 'blocked', 'banned', '2fa'];

/**
 * 从 GitHub 授权跳回来时，地址栏上会带 ?oauth=<结果码>：
 * 这里提示一下然后把参数清掉（否则刷新会重复提示）。
 */
function handleOauthResult(): void {
  let code = '';
  try {
    code = new URLSearchParams(location.search).get('oauth') || '';
  } catch (e) {
    return;
  }
  if (!code) return;
  if (code === 'bound') {
    notify('oauth.bound', true);
  } else {
    notify('oauth.err.' + (OAUTH_ERR_CODES.indexOf(code) !== -1 ? code : 'failed'));
  }
  try {
    history.replaceState(null, '', location.pathname);
  } catch (e) {
    /* 忽略 */
  }
}

export function initChat(): void {
  handleOauthResult();
  loadMe().then((ok) => {
    if (!ok) return;
    Promise.all([loadUsers(), loadFriends(), loadGroups()]).then(() => {
      // 会话恢复优先级：地址栏 → 第一个群组 → 空状态（移除公共频道后不再默认进公共房）。
      // gid / dm 必须是真实存在的会话才采纳，避免复制来的坏链接把界面带进空态。
      const want = roomFromUrl();
      if (want.gid && state.myGroups.some((g) => g.id === want.gid)) {
        switchRoom(want.gid);
      } else if (want.dm && want.dm !== state.me && state.allUsers.some((u) => u.name === want.dm)) {
        switchRoomToDm(want.dm);
      } else if (state.activeGid == null && state.activeDmPeer == null && state.myGroups.length) {
        switchRoom(state.myGroups[0].id);
      }
      connectWs();
    });
    get('/api/settings')
      .then((j) => {
        if (!j.ok || !j.settings) return;
        const s = j.settings as any;
        if (s.notify != null) state.notifyOn = !!s.notify;
        if (s.sendKey === 'enter' || s.sendKey === 'ctrl') state.sendKey = s.sendKey;
        if (typeof s.notifySound === 'string' && isNotifySound(s.notifySound)) {
          state.notifySound = s.notifySound;
          soundSetNotify(s.notifySound);
        }
        if (typeof s.soundIn === 'boolean') state.soundIn = s.soundIn;
        if (typeof s.soundOut === 'boolean') state.soundOut = s.soundOut;
        if (typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1) {
          state.volume = s.volume;
          if (s.volume > 0) lastVolume = s.volume;
        }
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

/** 该用户是否「离开」（在线但后台）——自己永远不算离开 */
export function isAway(name: string): boolean {
  return name !== state.me && state.away.indexOf(name) !== -1;
}

/**
 * 该用户是否有桌面客户端在线。
 * 窗口抖动是客户端能力，对方只在网页端时抖了也没效果，所以按钮据此禁用。
 */
export function isClientOnline(name: string): boolean {
  const p = state.platforms[name];
  return !!(p && p.client);
}

/** 侧栏 / 资料页状态文案 key（用法：tr('common.' + statusKey(name))） */
export function statusKey(name: string): StatusKey {
  return presenceStatusKey(isOnline(name), isAway(name), state.platforms[name]);
}

/** 状态文案：在线/离开按状态词显示，离线时显示「最后在线 x」 */
export function statusText(name: string): string {
  return presenceText(isOnline(name), isAway(name), state.platforms[name], state.lastSeen[name]);
}

// ---------------- 聊天记录搜索 ----------------

/** 打开搜索面板；scope=room 搜当前会话，all 搜全部会话 */
export function openSearch(scope: SearchScope = 'room'): void {
  state.searchScope = scope === 'all' ? 'all' : 'room';
  state.searchOpen = true;
  if (state.searchQuery.trim()) runSearch();
}

export function closeSearch(): void {
  state.searchOpen = false;
}

export function setSearchScope(scope: SearchScope): void {
  state.searchScope = scope === 'all' ? 'all' : 'room';
  if (state.searchQuery.trim()) runSearch();
}

/**
 * 执行搜索。带自增序号丢弃过期响应——输入框是连续触发的，
 * 先发的请求可能后回来，不丢的话结果会来回跳。
 */
export function runSearch(): void {
  const q = state.searchQuery.trim();
  const seq = ++searchSeq;
  if (!q) {
    state.searchHits = [];
    state.searchTotal = 0;
    state.searchLoading = false;
    state.searchError = '';
    return;
  }
  let path = '/api/messages/search?limit=50&q=' + encodeURIComponent(q);
  if (state.searchScope === 'room') {
    if (state.activeGid != null) path += '&gid=' + encodeURIComponent(String(state.activeGid));
    else if (state.activeDmPeer != null) path += '&dm=' + encodeURIComponent(state.activeDmPeer);
    else {
      state.searchHits = []; // 没有进入任何会话，没什么可搜的
      state.searchTotal = 0;
      return;
    }
  }
  state.searchLoading = true;
  state.searchError = '';
  get(path)
    .then((j) => {
      if (seq !== searchSeq) return;
      state.searchLoading = false;
      if (!j.ok) {
        state.searchError = j.error || 'common.loadFailed';
        state.searchHits = [];
        state.searchTotal = 0;
        return;
      }
      state.searchHits = (j.hits as SearchHit[]) || [];
      state.searchTotal = Number(j.total) || 0;
    })
    .catch(() => {
      if (seq !== searchSeq) return;
      state.searchLoading = false;
      state.searchError = 'common.loadFailed';
    });
}

/**
 * 跳到某条消息（滚动到中间 + 高亮闪烁）。
 * 切会话后历史是异步拉的，所以带几次重试；真的不在当前加载范围
 * （每个房间只保留最近 MAX_MESSAGES 条）时给个提示，而不是点了没反应。
 */
export function jumpToMessage(idx: number, tries = 8): void {
  const el = document.querySelector('.msg[data-idx="' + idx + '"]');
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('highlight');
    window.setTimeout(() => el.classList.remove('highlight'), 1400);
    return;
  }
  if (tries > 0) {
    window.setTimeout(() => jumpToMessage(idx, tries - 1), 120);
    return;
  }
  notify('chat.reply.notInView');
}

/** 点搜索结果：切到所在会话再跳过去 */
export function searchJump(hit: SearchHit): void {
  if (!hit) return;
  if (hit.dm) {
    const peer = String(hit.dm).split(':').find((n) => n !== state.me) || '';
    if (peer) switchRoomToDm(peer);
  } else if (hit.gid != null) {
    switchRoom(String(hit.gid));
  }
  // 切会话会重新拉历史，等一拍再跳（jumpToMessage 自身还会重试）
  window.setTimeout(() => jumpToMessage(hit.idx), 60);
}

/** 某人的最后在线时间（ms），没有记录时返回 null */
export function lastSeenOf(name: string): number | null {
  return state.lastSeen[name] || null;
}

// ================= 自己的隐身 / 离开状态 =================

function readInvisible(): boolean {
  try {
    return localStorage.getItem('circlechat_invisible') === '1';
  } catch {
    return false;
  }
}
function isHiddenNow(): boolean {
  return typeof document !== 'undefined' && !!(document.hidden || document.visibilityState === 'hidden');
}

/** 我的当前状态（隐身是持久偏好，离开按页面是否在前台实时判定，均最终推给服务端） */
export const selfStatus = ref<{ invisible: boolean; away: boolean }>({ invisible: readInvisible(), away: isHiddenNow() });

function pushStatus(): void {
  const s = selfStatus.value;
  send({
    type: 'status',
    data: { invisible: s.invisible ? 1 : 0, away: !s.invisible && s.away ? 1 : 0 }
  });
}

/** 隐身：开启后其他人在线列表里看不到我 */
export function setInvisible(b: boolean): void {
  selfStatus.value.invisible = b;
  try {
    localStorage.setItem('circlechat_invisible', b ? '1' : '0');
  } catch {
    /* 隐私模式下忽略 */
  }
  pushStatus();
}

/** 页面切到前台 / 后台时更新「离开」状态 */
export function syncVisibility(): void {
  selfStatus.value.away = isHiddenNow();
  pushStatus();
}

// 监听页面可见性：不在前台即为「离开」
try {
  document.addEventListener('visibilitychange', syncVisibility);
  window.addEventListener('focus', syncVisibility);
  window.addEventListener('blur', syncVisibility);
} catch {
  /* 忽略 */
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

/**
 * 拉群成员列表（所有群成员都能看，服务端只要求「是本群成员」）。
 * 顺手把每个人的 lastSeen 并进 state.lastSeen——这样不在好友列表里的人
 * 也能显示「最后在线 x」，群成员面板与资料卡共用同一份数据。
 */
export function loadGroupMembers(gid: string): void {
  get('/api/groups/members?gid=' + encodeURIComponent(gid))
    .then((j) => {
      if (!j || !j.ok) return;
      const list = (j.members as GroupMember[]) || [];
      state.activeGroupMembers = list;
      list.forEach((m) => {
        if (m.lastSeen) state.lastSeen[m.name] = Number(m.lastSeen);
      });
    })
    .catch(() => {
      /* 忽略 */
    });
}

export { asset, clock, fmtSize, tr };

export const chatState = state;
