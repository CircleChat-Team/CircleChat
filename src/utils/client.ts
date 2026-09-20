/* ============================================================
 * 桌面客户端识别
 *
 * 桌面客户端的内置浏览器会把标识打进 UA：
 *   Mozilla/5.0 ... CircleChatDesktop/0.1.0
 * UA 会随**每一个**请求发出（页面文档、子资源、XHR/fetch、WebSocket 握手），
 * 因此服务端从 request.headers['user-agent'] 正则一把即可识别，
 * 不需要前端额外加请求头，也不需要服务端改动。
 *
 * 前端判断优先用客户端注入的全局变量 __CIRCLECHAT_CLIENT__（更可靠，
 * 不怕 UA 被改或被客户端伪造），取不到时退化到 UA 正则。
 *
 * 单独抽成模块，避免各处散落正则。
 * ============================================================ */

export interface DesktopClientInfo {
  version: string;
  platform: 'linux' | 'macos' | 'windows';
}

/** UA 里的客户端标识：CircleChatDesktop/<version> */
const CLIENT_UA_RE = /CircleChatDesktop\/([\d.]+)/;

function platformFromUa(ua: string): DesktopClientInfo['platform'] {
  if (/Macintosh|Mac OS X/.test(ua)) return 'macos';
  if (/Windows/.test(ua)) return 'windows';
  return 'linux';
}

/**
 * 当前页面是否运行在桌面客户端里；不在则返回 null。
 * UA 在页面生命周期内不会变，所以不必做成响应式，直接调即可。
 */
export function getDesktopClient(): DesktopClientInfo | null {
  // 优先用客户端注入的全局变量（更可靠，不怕 UA 被改）
  const marker = window.__CIRCLECHAT_CLIENT__;
  if (marker && marker.version) return { version: marker.version, platform: marker.platform };

  // 退化到 UA 判断
  const ua = navigator.userAgent;
  const m = CLIENT_UA_RE.exec(ua);
  if (!m) return null;
  return { version: m[1], platform: platformFromUa(ua) };
}
