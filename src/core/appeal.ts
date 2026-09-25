/* ============================================================
 * 处罚申诉
 *
 * 被处罚的人有两条路提交申诉：
 *   1. 还能登录（禁言 / 警告）→ 资料页直接提交，靠会话认人
 *   2. **登不进来**（封禁 / IP 封禁）→ 登录页提交，靠「用户名 + 密码」认人
 * 服务端两条路都走同一个接口：带会话就不必再输密码。
 * ============================================================ */
import { get, post } from './api';
import type { AppealItem, ApiResult } from '../types';

/**
 * 提交申诉。
 * @param reason 申诉理由
 * @param creds  未登录时必须给（用户名 + 密码）；已登录时传 null 即可
 */
export function submitAppeal(reason: string, creds?: { username: string; password: string } | null): Promise<ApiResult> {
  const body: Record<string, string> = { reason: reason.trim() };
  if (creds) {
    body.username = creds.username.trim();
    body.password = creds.password;
  }
  return post('/api/appeal', body);
}

/** 我提交过的申诉（新→旧）；拿到失败时返回空数组，调用方不必再判错 */
export function loadMyAppeals(): Promise<AppealItem[]> {
  return get('/api/me/appeals').then((j) => ((j.ok ? j.appeals : []) as AppealItem[]) || []);
}

/** 申诉状态 → 文案键（列表与徽标共用） */
export function appealStatusKey(status: string): string {
  if (status === 'approved') return 'mod.appeal.statusApproved';
  if (status === 'rejected') return 'mod.appeal.statusRejected';
  return 'mod.appeal.statusPending';
}
