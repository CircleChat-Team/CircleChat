/* ============================================================
 * CircleChat 前端 — 页面跳转
 * ============================================================ */

/**
 * 登录成功后的去向：
 * 优先取 ?next= 参数，但只接受站内相对路径（/ 开头且不是 //），
 * 避免被构造成跳转到外部站点。
 * 页面间跳转用同源路径，不加 apiBase（apiBase 只用于接口请求）。
 */
export function redirectAfterLogin(): void {
  let next = '';
  try {
    next = new URLSearchParams(location.search).get('next') || '';
  } catch {
    next = '';
  }
  const safe = next.charAt(0) === '/' && next.indexOf('//') !== 0;
  location.replace(safe ? next : '/chat.html');
}
