/* ============================================================
 * 小程序（MiniApp）—— 前端状态、商店、运行容器与 postMessage 桥
 *
 * 小程序是纯前端静态页面，跑在 sandbox="allow-scripts" 的 iframe 里：
 * 不透明源、拿不到 Cookie、碰不到宿主 DOM。因此：
 *   - 上下文（appId / userId / chatId / 已授权权限）由宿主在握手时下发
 *   - 数据读写默认由宿主代持 Cookie 发起同源请求（postMessage RPC）
 *   - 另发一枚会话派生的短时令牌，让小程序也能直连 /api/mini/*
 * ============================================================ */

import { reactive } from 'vue';
import { get, post, del } from './api';
import { chatState, notify } from './chat';

export type MiniScope = 'user' | 'group';

/** 索引里的一个小程序（manifest） */
export interface MiniAppItem {
  id: string;
  name: string;
  summary: string;
  description: string;
  icon: string;
  version: string;
  entry: string;
  permissions: string[];
  command: string;
  window: { width: number; height: number } | null;
  author: string;
  homepage: string;
  sourceId: string;
  sourceName: string;
  official: boolean;
  installedUser: boolean;
  installedGroup: boolean;
}

/** 一条安装记录 */
export interface MiniInstallItem {
  appId: string;
  name: string;
  icon: string;
  version: string;
  entry: string;
  summary: string;
  description: string;
  author: string;
  homepage: string;
  command: string;
  window: { width: number; height: number } | null;
  /** manifest 声明的全部权限 */
  permissions: string[];
  /** 实际授予的权限 */
  granted: string[];
  scopeType: MiniScope;
  scopeId: string;
  installedBy: string;
  created: number;
  updated: number;
}

/** 下发进 iframe 的运行上下文 */
export interface MiniContext {
  appId: string;
  userId: string;
  username: string;
  scope: MiniScope;
  scopeId: string;
  chatId: string;
  name: string;
  icon: string;
  entry: string;
  command: string;
  permissions: string[];
}

export interface MiniSourceStatus {
  id: string;
  name: string;
  official: boolean;
  enabled: boolean;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
}

/** 正在运行的小程序 */
export interface MiniRun {
  appId: string;
  name: string;
  icon: string;
  entry: string;
  scope: MiniScope;
  scopeId: string;
  command: string;
  args: string;
  width: number;
  height: number;
  permissions: string[];
  context: MiniContext | null;
  token: string;
  expires: number;
  loading: boolean;
  error: string;
  /** 已进入运行态（握手完成或超时后不再重复下发 invoke） */
  invoked: boolean;
}

export interface MiniState {
  /** 商店 / 已安装面板 */
  panelOpen: boolean;
  panelTab: 'installed' | 'store' | 'detail';
  /** 详情页当前展示的 app（store 列表里点「详情」） */
  detailApp: MiniAppItem | null;
  apps: MiniAppItem[];
  installs: MiniInstallItem[];
  sources: MiniSourceStatus[];
  permissions: string[];
  updatedAt: number;
  loading: boolean;
  error: string;
  /** 运行中的小程序（null = 没在跑） */
  running: MiniRun | null;
}

export const miniState = reactive<MiniState>({
  panelOpen: false,
  panelTab: 'installed',
  detailApp: null,
  apps: [],
  installs: [],
  sources: [],
  permissions: [],
  updatedAt: 0,
  loading: false,
  error: '',
  running: null
});

const PROTO = 'circlechat-mini';
/** 当前所在群（群级安装与 #指令 都锚定它） */
function currentGid(): string {
  return chatState.activeGid != null ? String(chatState.activeGid) : '';
}

/* ------------------------------ 商店 ------------------------------ */

export function openMiniPanel(tab: 'installed' | 'store' | 'detail' = 'installed'): void {
  miniState.panelOpen = true;
  miniState.panelTab = tab;
  void loadMiniIndex();
  void loadMiniInstalls();
}

export function closeMiniPanel(): void {
  miniState.panelOpen = false;
}

export function setMiniTab(tab: 'installed' | 'store' | 'detail'): void {
  miniState.panelTab = tab;
}

export function openMiniDetail(app: MiniAppItem): void {
  miniState.detailApp = app;
  miniState.panelTab = 'detail';
}

/** 拉合并后的索引（带当前群的已安装标记） */
export function loadMiniIndex(): Promise<void> {
  miniState.loading = true;
  return get('/api/mini/index?id=' + encodeURIComponent(currentGid()))
    .then((j) => {
      if (!j.ok) {
        miniState.error = String(j.error || 'api.mini.loadFailed');
        return;
      }
      miniState.apps = (j.apps as MiniAppItem[]) || [];
      miniState.sources = (j.sources as MiniSourceStatus[]) || [];
      miniState.permissions = (j.permissions as string[]) || [];
      miniState.updatedAt = Number(j.updatedAt || 0);
      miniState.error = '';
    })
    .catch(() => {
      miniState.error = 'api.networkError';
    })
    .then(() => {
      miniState.loading = false;
    });
}

/** 拉当前会话可见的安装（个人级 + 本群级） */
export function loadMiniInstalls(): Promise<void> {
  return get('/api/mini/installed?id=' + encodeURIComponent(currentGid()))
    .then((j) => {
      if (j.ok) miniState.installs = (j.installs as MiniInstallItem[]) || [];
    })
    .catch(() => {
      /* 静默：失败时保留上一次的列表 */
    });
}

/** 安装（scope='group' 时安装到当前群） */
export function installMiniApp(app: MiniAppItem, scope: MiniScope, granted: string[]): Promise<boolean> {
  const payload: Record<string, unknown> = {
    appId: app.id,
    scope,
    scopeId: scope === 'group' ? currentGid() : '',
    granted
  };
  return post('/api/mini/install', payload)
    .then((j) => {
      if (!j.ok) {
        notify(String(j.error || 'api.mini.installFailed'));
        return false;
      }
      notify('mini.install.ok', true);
      void loadMiniInstalls();
      void loadMiniIndex();
      return true;
    })
    .catch(() => {
      notify('api.networkError');
      return false;
    });
}

export function uninstallMiniApp(inst: MiniInstallItem): Promise<boolean> {
  return post('/api/mini/uninstall', { appId: inst.appId, scope: inst.scopeType, scopeId: inst.scopeId })
    .then((j) => {
      if (!j.ok) {
        notify(String(j.error || 'api.mini.uninstallFailed'));
        return false;
      }
      notify('mini.uninstalled', true);
      void loadMiniInstalls();
      void loadMiniIndex();
      return true;
    })
    .catch(() => {
      notify('api.networkError');
      return false;
    });
}

export function regrantMiniApp(inst: MiniInstallItem, granted: string[]): Promise<boolean> {
  return post('/api/mini/regrant', { appId: inst.appId, scope: inst.scopeType, scopeId: inst.scopeId, granted })
    .then((j) => {
      if (!j.ok) {
        notify(String(j.error || 'api.mini.regrantFailed'));
        return false;
      }
      notify('mini.regranted', true);
      void loadMiniInstalls();
      return true;
    })
    .catch(() => {
      notify('api.networkError');
      return false;
    });
}

/* --------------------------- #指令 解析 --------------------------- */

export interface MiniCommandHit {
  install: MiniInstallItem;
  command: string;
  args: string;
}

const CMD_RE = /^#([A-Za-z0-9_-]{1,24})(?:[ \t]+([\s\S]*))?$/;

/** 把「#cmd 参数」解析成一次小程序调用；不匹配或未安装返回 null */
export function resolveMiniCommand(text: string): MiniCommandHit | null {
  const m = CMD_RE.exec(String(text || '').trim());
  if (!m) return null;
  const command = m[1].toLowerCase();
  const args = String(m[2] || '').trim();
  const list = miniState.installs;
  const inGroup = list.find((i) => i.scopeType === 'group' && i.command === command);
  const mine = list.find((i) => i.scopeType === 'user' && i.command === command);
  const install = inGroup || mine;
  return install ? { install, command, args } : null;
}

/** 输入框提交时调用：命中 #指令 就打开小程序，返回 true 表示已接管（不要发原文） */
export function tryRunMiniCommand(text: string): boolean {
  const hit = resolveMiniCommand(text);
  if (!hit) return false;
  void openMiniApp(hit.install, { command: hit.command, args: hit.args });
  return true;
}

/** 候选补全：输入以 # 开头时列出可调用的小程序 */
export function miniCommandCandidates(prefix: string): MiniInstallItem[] {
  const p = String(prefix || '').replace(/^#/, '').toLowerCase();
  const seen = new Set<string>();
  const out: MiniInstallItem[] = [];
  for (const i of miniState.installs) {
    if (!i.command) continue;
    if (p && i.command.indexOf(p) !== 0) continue;
    const key = i.appId + '/' + i.scopeType;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
    if (out.length >= 6) break;
  }
  return out;
}

/* --------------------------- 运行容器 --------------------------- */

function ensureContext(run: MiniRun): Promise<boolean> {
  const q = '?appId=' + encodeURIComponent(run.appId) +
    '&scope=' + encodeURIComponent(run.scope) +
    '&scopeId=' + encodeURIComponent(run.scopeId);
  return get('/api/mini/context' + q)
    .then((j) => {
      if (!j.ok) {
        run.error = String(j.error || 'api.mini.contextFailed');
        run.loading = false;
        return false;
      }
      run.context = (j.context as MiniContext) || null;
      run.token = String(j.token || '');
      run.expires = Number(j.expires || 0);
      run.permissions = (run.context && run.context.permissions) || run.permissions;
      return true;
    })
    .catch(() => {
      run.error = 'api.networkError';
      run.loading = false;
      return false;
    });
}

let contextPromise: Promise<boolean> | null = null;
let contextKey = '';

export function openMiniApp(inst: MiniInstallItem, opts?: { command?: string; args?: string }): Promise<void> {
  const run: MiniRun = {
    appId: inst.appId,
    name: inst.name,
    icon: inst.icon,
    entry: inst.entry,
    scope: inst.scopeType,
    scopeId: inst.scopeId,
    command: opts && opts.command ? opts.command : inst.command || '',
    args: opts && opts.args ? opts.args : '',
    width: inst.window ? inst.window.width : 420,
    height: inst.window ? inst.window.height : 640,
    permissions: inst.granted || [],
    context: null,
    token: '',
    expires: 0,
    loading: true,
    error: '',
    invoked: false
  };
  miniState.running = run;
  miniState.panelOpen = false;
  const key = run.appId + '|' + run.scope + '|' + run.scopeId;
  if (contextKey !== key || !contextPromise) {
    contextKey = key;
    contextPromise = ensureContext(run);
  } else {
    void contextPromise.then((ok) => {
      if (!ok) return;
      run.context = miniState.running ? miniState.running.context : null;
    });
  }
  // 记录一次调用（审计）
  if (run.command) {
    void post('/api/mini/invoke', {
      appId: run.appId, scope: run.scope, scopeId: run.scopeId, command: run.command
    });
  }
  return contextPromise.then(() => {
    const cur = miniState.running;
    if (cur && cur.appId === run.appId) cur.loading = false;
  });
}

export function closeMiniApp(): void {
  miniState.running = null;
  contextPromise = null;
  contextKey = '';
}

/* ------------------------------ 桥 ------------------------------ */

function reply(frame: HTMLIFrameElement, payload: Record<string, unknown>): void {
  try {
    frame.contentWindow?.postMessage({ __cc: PROTO, payload }, '*');
  } catch {
    /* iframe 已卸载 */
  }
}

function deny(): { ok: boolean; error: string } {
  return { ok: false, error: 'api.mini.noPerm' };
}

/** 处理小程序发来的一次 RPC：权限在此兜一层，真正的校验在后端 */
function runRpc(run: MiniRun, method: string, params: Record<string, unknown>): Promise<unknown> {
  const p = params || {};
  const base = { appId: run.appId, scope: run.scope, scopeId: run.scopeId };
  const has = (perm: string) => run.permissions.indexOf(perm) !== -1;

  if (method === 'context.get') return Promise.resolve(run.context);
  if (method === 'close') {
    closeMiniApp();
    return Promise.resolve({ ok: true });
  }
  if (method === 'profile.get') {
    if (!has('profile.read')) return Promise.resolve(deny());
    return get('/api/profile?name=' + encodeURIComponent(chatState.me));
  }
  if (method === 'chat.get') {
    if (!has('chat.read')) return Promise.resolve(deny());
    const q = '?appId=' + encodeURIComponent(run.appId) +
      '&scope=' + encodeURIComponent(run.scope) +
      '&scopeId=' + encodeURIComponent(run.scopeId) +
      '&limit=' + encodeURIComponent(String(Math.min(Number(p.limit) || 50, 100))) +
      (p.gid ? '&gid=' + encodeURIComponent(String(p.gid)) : '') +
      (p.pm ? '&pm=' + encodeURIComponent(String(p.pm)) : '');
    return get('/api/mini/chat' + q);
  }
  if (method === 'message.send') {
    if (!has('message.send')) return Promise.resolve(deny());
    return post('/api/mini/message', {
      ...base,
      content: String(p.text || '').slice(0, 4096),
      md: p.md ? 1 : 0,
      gid: p.gid ? String(p.gid) : '',
      pm: p.pm ? String(p.pm) : ''
    });
  }
  if (method === 'kv.get') {
    if (!has('kv.read')) return Promise.resolve(deny());
    return get('/api/mini/kv' + '?appId=' + encodeURIComponent(run.appId) +
      '&scope=' + encodeURIComponent(run.scope) +
      '&scopeId=' + encodeURIComponent(run.scopeId) +
      '&k=' + encodeURIComponent(String(p.key || '')));
  }
  if (method === 'kv.list') {
    if (!has('kv.read')) return Promise.resolve(deny());
    return get('/api/mini/kv' + '?appId=' + encodeURIComponent(run.appId) +
      '&scope=' + encodeURIComponent(run.scope) +
      '&scopeId=' + encodeURIComponent(run.scopeId));
  }
  if (method === 'kv.set') {
    if (!has('kv.write')) return Promise.resolve(deny());
    return post('/api/mini/kv', { ...base, k: String(p.key || ''), v: String(p.value == null ? '' : p.value) });
  }
  if (method === 'kv.del') {
    if (!has('kv.write')) return Promise.resolve(deny());
    return del('/api/mini/kv', { ...base, k: String(p.key || '') });
  }
  return Promise.resolve({ ok: false, error: 'api.mini.unknownMethod' });
}

/**
 * 在宿主页面上挂上桥：只受理来自「当前这个 iframe」的消息。
 * 沙箱下 event.origin 恒为 null，不能用于校验，只能比对 event.source。
 */
export function attachMiniBridge(getFrame: () => HTMLIFrameElement | null): () => void {
  function onMessage(e: MessageEvent): void {
    const run = miniState.running;
    const frame = getFrame();
    if (!run || !frame) return;
    if (e.source !== frame.contentWindow) return;
    const d = e.data as { __cc?: string; payload?: Record<string, unknown> } | null;
    if (!d || d.__cc !== PROTO) return;
    const m = d.payload || {};

    if (m.type === 'hello') {
      const deliver = () => {
        const cur = miniState.running;
        const f = getFrame();
        if (!cur || !f) return;
        reply(f, {
          type: 'context',
          context: cur.context,
          token: cur.token,
          expires: cur.expires,
          apiBase: location.origin
        });
        if (!cur.invoked && cur.command) {
          cur.invoked = true;
          reply(f, { type: 'invoke', command: cur.command, args: cur.args, chatId: cur.context ? cur.context.chatId : '' });
        }
      };
      if (run.context) deliver();
      else if (contextPromise) void contextPromise.then(deliver);
      return;
    }

    if (m.type === 'rpc') {
      const id = Number(m.id);
      void runRpc(run, String(m.method || ''), (m.params as Record<string, unknown>) || {})
        .then((data) => {
          const f = getFrame();
          if (f) reply(f, { type: 'rpc.result', id, ok: true, data });
        })
        .catch(() => {
          const f = getFrame();
          if (f) reply(f, { type: 'rpc.result', id, ok: false, error: 'api.mini.rpcFailed' });
        });
      return;
    }

    if (m.type === 'close') closeMiniApp();
  }

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
