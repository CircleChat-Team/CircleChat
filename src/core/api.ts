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

/**
 * 把 /uploads/xxx 转成可访问的完整地址（兼容跨域 apiBase）。
 * 放在这里而不是各页面各写一份：聊天页、群管理页、管理面板都要用。
 */
export function asset(u: string): string {
  if (/^[a-z]+:/i.test(u)) return u; 
  return url(u);
}

/** 展示用的服务器地址（未配置时取当前页面 origin） */
export function displayBase(): string {
  return config.displayBase || location.origin;
}

/** 是否已在登录页：会话失效时避免反复重定向、也不打断登录表单 */
function onAuthPage(): boolean {
  return /\/login\.html$/.test(location.pathname);
}

async function toJson(res: Response): Promise<ApiResult> {
  let data: ApiResult;
  try {
    data = (await res.json()) as ApiResult;
  } catch {
    data = { ok: false, error: 'api.badRequest' };
  }
  // 会话已失效（服务端会话只在内存，重启 / 过期即全部登出）：统一回登录页。
  // 注意：登录失败 / 二次验证错误同样是 401，但错误码不是 api.unauthorized，
  // 因此不会误触发跳转，登录页自身的表单逻辑不受影响。
  if (res.status === 401 && data.error === 'api.unauthorized' && !onAuthPage()) {
    location.replace('/login.html');
  }
  return data;
}

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
