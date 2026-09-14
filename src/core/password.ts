// ============================================================
// 密码强度校验（与 server.js passwordStrength 保持一致）
// 要求：长度 ≥8，且同时包含数字、小写字母、大写字母、特殊符号
// ============================================================
export const MIN_PASS_LEN = 8;
export const MAX_PASS_LEN = 64;

export function passwordOk(p: string): boolean {
  if (typeof p !== 'string' || p.length < MIN_PASS_LEN || p.length > MAX_PASS_LEN) return false;
  return /[0-9]/.test(p) && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[^A-Za-z0-9]/.test(p);
}