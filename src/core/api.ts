/* ============================================================
 * CircleChat 前端 — 请求层
 * 统一封装同源 fetch：地址前缀、JSON 解析、异常兜底。
 * ============================================================ */

import type { ApiResult } from '../types';
import { config } from './config';

const BASE = config.apiBase;

/** 拼接请求地址（/uploads 等静态资源也走这里） */
export function url(path: string): string {
  return BASE + path;
}

/** 展示用的服务器地址（未配置时取当前页面 origin） */
export function displayBase(): string {
  return config.displayBase || location.origin;
}

async function toJson(res: Response): Promise<ApiResult> {
  try {
    return (await res.json()) as ApiResult;
  } catch {
    return { ok: false, error: 'api.badRequest' };
  }
}

/** GET 请求 */
export function get(path: string): Promise<ApiResult> {
  return fetch(url(path), { credentials: 'same-origin' }).then(toJson);
}

/** POST 请求，body 为 JSON */
export function post(path: string, payload?: unknown): Promise<ApiResult> {
  return fetch(url(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  }).then(toJson);
}

/** DELETE 请求（解散群等），body 为 JSON */
export function del(path: string, payload?: unknown): Promise<ApiResult> {
  return fetch(url(path), {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  }).then(toJson);
}
