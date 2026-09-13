/* ============================================================
 * ChatPlus 前端 — 深色模式
 * 偏好存在 localStorage，与登录页 / 聊天页共用。
 * ============================================================ */

import { ref } from 'vue';

export type ThemeName = 'dark' | 'light';

/** 当前主题（响应式） */
export const theme = ref<ThemeName>(read());

function read(): ThemeName {
  let s: string | null = null;
  try {
    s = localStorage.getItem('chatplus_theme');
  } catch {
    s = null;
  }
  if (s === 'dark' || s === 'light') return s;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(t: ThemeName): void {
  document.documentElement.setAttribute('data-theme', t);
  theme.value = t;
}

/** 在明暗之间切换 */
export function toggleTheme(): void {
  const t: ThemeName = theme.value === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('chatplus_theme', t);
  } catch {
    /* 隐私模式下忽略 */
  }
  applyTheme(t);
}

/** 初始化：尽早应用，避免首屏闪白 */
export function initTheme(): void {
  applyTheme(read());
}
