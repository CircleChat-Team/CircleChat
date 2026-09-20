/* ============================================================
 * 系统通知（仅桌面客户端）
 *
 * 网页端不再使用浏览器的 Notification API：它要 HTTPS、要用户授权、
 * 各浏览器表现还不一致。系统通知统一交给桌面客户端，页面通过
 * window.__CIRCLECHAT__.notify 走 IPC 由客户端代为弹出。
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
