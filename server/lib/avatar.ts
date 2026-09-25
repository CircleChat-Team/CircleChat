// CircleChat — 头像校验（本人 / 群 / 管理员三处入口共用）
/* ------------------------------------------------------------
 * 头像一律只接受「本站上传的图片路径」，不接受外链。
 *
 * 为什么：头像会在消息列表、成员列表、好友列表里被**每个**客户端加载。
 * 允许任意 http(s) 地址，等于让一个人拿所有人的浏览器去请求他指定的地址
 * —— 泄露访问者 IP，还能用内网地址当探测用（比如 http://192.168.x.x/）。
 * 上传路径由 /api/upload 生成、不可伪造，因此只认它。
 *
 * 空串表示「清除头像」。
 * ---------------------------------------------------------- */

/** 形如 /uploads/abcd1234.png —— 与上传接口落盘后返回的 url 一致 */
export const AVATAR_PATH_RE = /^\/uploads\/[a-zA-Z0-9]+\.[a-zA-Z0-9]{1,8}$/;

/** 写入校验：空串（清除）或本站上传路径 */
export function isValidAvatar(v: string): boolean {
  return v === '' || AVATAR_PATH_RE.test(v);
}

/**
 * 读出兜底：库里可能还留着改成上传之前存进去的外链，
 * 一律当作「没有头像」返回（不再发给客户端，也就不会再被任何人加载）。
 */
export function safeAvatar(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  return AVATAR_PATH_RE.test(s) ? s : null;
}
