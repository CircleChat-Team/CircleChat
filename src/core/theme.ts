/* ============================================================
 * CircleChat 前端 — 深色模式
 * 偏好存在 localStorage，与登录页 / 聊天页共用。
 * ============================================================ */

import { ref } from 'vue';

export type ThemeName = 'dark' | 'light';

/** 当前主题（响应式） */
export const theme = ref<ThemeName>(read());

/** 自定义强调色（hex 或 '' 表示默认），persist 到 localStorage */
export const accent = ref<string>(readAccent());

function read(): ThemeName {
  let s: string | null = null;
  try {
    s = localStorage.getItem('circlechat_theme');
  } catch {
    s = null;
  }
  if (s === 'dark' || s === 'light') return s;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readAccent(): string {
  try {
    return localStorage.getItem('circlechat_accent') || '';
  } catch {
    return '';
  }
}

/** 将 hex 加深/变浅，k>0 加深，k<0 变亮 */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const target = k < 0 ? 255 : 0;
  const p = Math.abs(k);
  r = Math.round((target - r) * p + r);
  g = Math.round((target - g) * p + g);
  b = Math.round((target - b) * p + b);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/** 应用自定义强调色：覆盖品牌/己方气泡色 */
export function applyAccent(c: string): void {
  const el = document.documentElement.style;
  if (!c || !/^#[0-9a-fA-F]{6}$/.test(c)) {
    el.removeProperty('--primary');
    el.removeProperty('--primary-dark');
    el.removeProperty('--self');
    return;
  }
  el.setProperty('--primary', c);
  el.setProperty('--primary-dark', shade(c, 0.15));
  el.setProperty('--self', c);
}

export function setAccent(c: string): void {
  accent.value = c;
  try {
    localStorage.setItem('circlechat_accent', c);
  } catch {
    /* 隐私模式下忽略 */
  }
  applyAccent(c);
}

export function applyTheme(t: ThemeName): void {
  document.documentElement.setAttribute('data-theme', t);
  theme.value = t;
}

/** 在明暗之间切换 */
export function toggleTheme(): void {
  const t: ThemeName = theme.value === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('circlechat_theme', t);
  } catch {
    /* 隐私模式下忽略 */
  }
  applyTheme(t);
}

/** 初始化：尽早应用，避免首屏闪白 */
export function initTheme(): void {
  applyTheme(read());
  applyAccent(accent.value);
}
