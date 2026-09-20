/* ============================================================
 * CircleChat 前端 — 聊天核心（组合式单例）
 * 封装 WebSocket 连接、REST 调用、消息收发与会话状态。
 * 所有组件 import 同一个实例，状态天然共享。
 * ============================================================ */

import { reactive, ref } from 'vue';
import { get, post, url } from './api';
import { config } from './config';
import { tr } from './i18n';
import { fmtSize } from './format';
import { DEFAULT_NOTIFY_SOUND, isNotifySound, playIncoming, playOutgoing, setNotifySound as soundSetNotify } from './sound';
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
  MergeItem
} from '../types';

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
  mustChange: boolean;
  online: string[];
  away: string[];
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
    pushStatus();
  };

  sock.onmessage = (ev: MessageEvent) => {
    let obj: { type?: string; data?: any; from?: string; users?: string[]; away?: string[]; by?: string; owner?: string; admin?: boolean; username?: string } | null = null;
    try {
      obj = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    switch (obj.type) {
      case 'msg':
        if (obj.data) {
          bumpRoom(obj.data);
          maybeNotify(obj.data);
          const inRoom = msgInActiveRoom(obj.data);
          if (inRoom) appendMsg(obj.data);
          // 仅他人发来的消息：非当前会话则累加未读，并播提示音
          if (obj.data.from !== state.me) {
            if (!inRoom) addUnread(obj.data);
            playIncoming();
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
        break;
      case 'groups.changed':
        loadGroups();
        break;
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

export function switchRoom(gid: string | null): void {
  state.activeGid = gid == null ? null : String(gid);
  state.activeDmPeer = null;
  state.replyTo = null;
  state.activeGroupMembers = [];
  if (gid != null) clearUnread('g:' + String(gid));
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
  clearUnread('d:' + p);
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
    state.mustChange = !!j.mustChange;
    state.online = (j.online as string[]) || [];
    state.away = (j.away as string[]) || [];
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
  playOutgoing();
  state.replyTo = null;
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
}

let uploadSeq = 0;
/** 同时进行的上传数：全串行太慢、全并行又挤带宽，取 3 作折中 */
const MAX_CONCURRENT_UPLOADS = 3;
/** 任务 id → 待上传文件；不放进响应式状态，避免 Vue 代理 DOM 对象 */
const pendingFiles = new Map<number, File>();
/** 任务 id → 速度采样（非响应式，避免每个进度事件都额外渲染一次） */
const speedTrack = new Map<number, { loaded: number; ts: number; ema: number }>();
/** 任务 id → 进行中的 XHR，供「取消上传」中断请求 */
const uploadXhr = new Map<number, XMLHttpRequest>();
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

/** POST /api/upload；用 XHR 而非 fetch：只有 XHR 能拿到上传进度事件，也只有它能被中断 */
function postUpload(id: number, file: File, onProgress: (loaded: number, total: number) => void): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    uploadXhr.set(id, xhr);
    const cleanup = (): void => {
      if (uploadXhr.get(id) === xhr) uploadXhr.delete(id);
    };
    xhr.open('POST', api('/api/upload'), true);
    xhr.withCredentials = true;
    // 超时按文件大小估算：固定 2 分钟对大文件必然超时（看起来就像传到一半卡住）。
    // 下限 2 分钟，上限 30 分钟。
    xhr.timeout = Math.min(30 * 60 * 1000, Math.max(120000, Math.round((file.size / (50 * 1024)) * 1000)));
    xhr.upload.onprogress = (e: ProgressEvent): void => {
      if (e.lengthComputable && e.total) onProgress(e.loaded, e.total);
    };
    xhr.onload = (): void => {
      cleanup();
      let body: ApiResult = { ok: false };
      try {
        body = JSON.parse(xhr.responseText || '{}') as ApiResult;
      } catch {
        body = { ok: false };
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error('http ' + xhr.status));
        return;
      }
      resolve(body);
    };
    xhr.onerror = (): void => { cleanup(); reject(new Error('network')); };
    xhr.ontimeout = (): void => { cleanup(); reject(new Error('timeout')); };
    xhr.onabort = (): void => { cleanup(); reject(new Error('abort')); };
    xhr.send(fd);
  });
}

function failUpload(id: number, error: string): void {
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
  if (send({ type: 'msg', data })) playOutgoing();
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

async function runUpload(id: number): Promise<void> {
  const file = pendingFiles.get(id);
  if (!file || !taskById(id)) return;
  speedTrack.set(id, { loaded: 0, ts: 0, ema: 0 });
  patchTask(id, { status: 'uploading', percent: 0, loaded: 0, error: '', speed: 0 });
  try {
    const body = await postUpload(id, file, (loaded, total) => {
      // 速度：进度事件很密，按 ≥200ms 采样 + 指数平均平滑，避免数字乱跳
      let speed = 0;
      const st = speedTrack.get(id);
      if (st) {
        const now = performance.now();
        if (!st.ts) {
          st.ts = now;
          st.loaded = loaded;
        } else if (now - st.ts >= 200) {
          const inst = (loaded - st.loaded) / ((now - st.ts) / 1000);
          st.ema = st.ema > 0 ? st.ema * 0.6 + inst * 0.4 : inst;
          st.loaded = loaded;
          st.ts = now;
        }
        speed = Math.max(0, st.ema);
      }
      // 留 1%：等服务器写盘并返回后才算完成
      patchTask(id, { percent: Math.min(99, Math.round((loaded / total) * 100)), loaded, speed });
    });
    if (!body.ok) {
      failUpload(id, String(body.error || 'chat.upload.failed'));
      return;
    }
    if (dmgating() && body.kind !== 'image') {
      failUpload(id, 'chat.dm.gateToast');
      return;
    }
    // 先攒结果，等更早的任务也就绪后按序发送
    readyResults.set(id, {
      kind: String(body.kind),
      url: String(body.url),
      name: String(body.name),
      size: Number(body.size)
    });
    flushReady();
  } catch (e) {
    // 用户主动取消：任务已移除，不当作失败（否则会弹一条"上传失败"）
    if (e instanceof Error && e.message === 'abort') return;
    failUpload(id, 'chat.upload.retry');
  }
}

/** 取消上传：中断进行中的请求并从队列移除（排队中的任务直接移除） */
export function cancelUpload(id: number): void {
  const xhr = uploadXhr.get(id);
  if (xhr) {
    uploadXhr.delete(id);
    try { xhr.abort(); } catch { /* 忽略 */ }
  }
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

/**
 * 开启/关闭通知。开启时必须在"用户手势"内请求权限（浏览器要求），
 * 尤其 Windows/Edge 下否则不会弹权限框。权限被拒则保持关闭。
 */
export async function setNotify(enabled: boolean): Promise<boolean> {
  const on = await (async () => {
    if (!enabled) return false;
    if (typeof Notification === 'undefined') return false; // 环境不支持
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      // 在用户手势(点击/切换)内同步发起请求，Edge/Chrome 才会唤醒权限弹窗
      return (await Notification.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  })();
  state.notifyOn = on;
  void post('/api/settings', { notify: on }).catch(() => {
    /* 忽略 */
  });
  return on;
}

/** 新消息到达：不在当前会话 或 页面隐藏 时弹出系统通知 */
export function maybeNotify(m: ChatMessage): void {
  if (!state.notifyOn || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
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
  try {
    const n = new Notification(title, { body: body.slice(0, 200), tag: 'cc-' + (m.id || Date.now()) });
    n.onclick = () => {
      window.focus();
      try {
        n.close();
      } catch {
        /* 忽略 */
      }
    };
  } catch {
    /* 忽略 */
  }
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
        if (!j.ok || !j.settings) return;
        const s = j.settings as any;
        if (s.notify != null) state.notifyOn = !!s.notify;
        if (s.sendKey === 'enter' || s.sendKey === 'ctrl') state.sendKey = s.sendKey;
        if (typeof s.notifySound === 'string' && isNotifySound(s.notifySound)) {
          state.notifySound = s.notifySound;
          soundSetNotify(s.notifySound);
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

/** 侧栏 / 资料页状态文案：离开 > 在线 > 离线 */
export function statusKey(name: string): 'away' | 'online' | 'offline' {
  if (isAway(name)) return 'away';
  return isOnline(name) ? 'online' : 'offline';
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
