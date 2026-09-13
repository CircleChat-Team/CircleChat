/* ============================================================
 * CircleChat 前端 — 部署配置（包装 public/js/config.js 注入的全局）
 *
 * public/js/config.js 仍由运维在部署时直接编辑（免构建改 apiBase/displayBase），
 * 这里只把它收口成带类型的模块，供 src 内统一读取，去掉散落的 window.CHAT_CONFIG。
 * ============================================================ */

export interface ChatConfig {
  apiBase: string;
  displayBase: string;
}

interface RawConfig {
  apiBase?: string;
  displayBase?: string;
}

function readConfig(): ChatConfig {
  const w = typeof window !== 'undefined' ? (window as unknown as { CHAT_CONFIG?: RawConfig }) : undefined;
  const raw = (w && w.CHAT_CONFIG) || {};
  return {
    apiBase: String(raw.apiBase || '').replace(/\/+$/, ''),
    displayBase: String(raw.displayBase || '').replace(/\/+$/, '')
  };
}

export const config: ChatConfig = readConfig();

/** 展示用的服务器地址（未配置时取当前页面 origin） */
export function displayBase(): string {
  return config.displayBase || location.origin;
}
