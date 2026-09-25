/* ============================================================
 * 系统通知与窗口抖动（仅桌面客户端）
 *
 * 网页端不再使用浏览器的 Notification API：它要 HTTPS、要用户授权、
 * 各浏览器表现还不一致。系统通知统一交给桌面客户端，页面通过
 * window.__CIRCLECHAT__.notify 走 IPC 由客户端代为弹出。
 * 另外客户端还提供 shakeWindow()（窗口抖一下抢注意力），与通知配合使用。
 *
 * 客户端返回：
 *   { ok: true,  error: null }
 *   { ok: false, error: 'ipc-unavailable' | 'timeout' | <系统通知服务的报错> }
 * ============================================================ */

export interface SystemNotifyResult {
  ok: boolean;
  error: string | null;
}

export interface SystemNotifyOptions {
  title?: string;
  body?: string;
}

/** 当前是否在桌面客户端里（客户端才会注入 window.__CIRCLECHAT__） */
export function canSystemNotify(): boolean {
  return !!window.__CIRCLECHAT__;
}

/**
 * 发一条系统通知。
 * 不在客户端里（比如用浏览器打开网页）时直接跳过并返回 ok:false，
 * 调用方据此决定是否退回应用内提示。
 */
export async function systemNotify(title: string, body?: string): Promise<SystemNotifyResult> {
  const api = window.__CIRCLECHAT__;
  if (!api) return { ok: false, error: 'not-desktop-client' };
  try {
    return await api.notify({ title, body });
  } catch (e) {
    // IPC 抛异常（而非返回 ok:false）时也兜住，不要让调用方 await 到 rejection
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ShakeResult {
  done: boolean;
  error?: string | null;
}

/**
 * 让客户端窗口抖一下，用于背景窗口抢注意力（配合系统通知一起用）。
 *
 * 只有桌面客户端才有这个能力；网页端、以及还没有这个方法的老客户端
 * 都返回 { done: false }，调用方当无事发生即可。
 * 注：Wayland 下窗口位置由合成器管理，可能只表现为置顶/闪烁而没有位移。
 */
export async function shakeWindow(): Promise<ShakeResult> {
  const api = window.__CIRCLECHAT__;
  // 用可选链判断，不假设客户端版本一定有这个方法
  if (!api || typeof api.shakeWindow !== 'function') return { done: false, error: 'ipc-unavailable' };
  try {
    const r = await api.shakeWindow();
    if (!r || typeof r !== 'object') return { done: false, error: 'bad-result' };
    return { done: !!r.done, error: r.error ?? null };
  } catch (e) {
    return { done: false, error: e instanceof Error ? e.message : String(e) };
  }
}
