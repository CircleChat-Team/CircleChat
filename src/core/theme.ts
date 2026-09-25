// CircleChat 前端 — 深色模式 偏好存在 localStorage，与登录页 / 聊天页共用。

import { ref } from 'vue';

export type ThemeName = 'dark' | 'light';

/** 当前主题（响应式） */
export const theme = ref<ThemeName>(read());

/** 自定义强调色（hex 或 '' 表示默认），persist 到 localStorage */
export const accent = ref<string>(readAccent());

/** 自定义配色（按主题分开，"" 表示不覆盖该 CSS 变量），persist 到 localStorage */
export interface StyleSet {
  bg: string;    
  panel: string; 
  text: string;  
}
export interface CustomStyles {
  light: StyleSet;
  dark: StyleSet;
}
export const customStyles = ref<CustomStyles>(readCustom());

/** 样式弹窗当前编辑的主题（亮/暗各有一套配色） */
export const customTheme = ref<ThemeName>(read() === 'dark' ? 'dark' : 'light');

const VALID_HEX = /^#[0-9a-fA-F]{6}$/;
// 用 function 声明而非 const 箭头：readCustom 在模块初始化（第 26 行）即被调用，
// const 会因尚未初始化而触发 TDZ 报 "emptySet is not a function"。
function emptySet(): StyleSet { return { bg: '', panel: '', text: '' }; }

function readCustom(): CustomStyles {
  const c: CustomStyles = { light: emptySet(), dark: emptySet() };
  try {
    const raw = localStorage.getItem('circlechat_styles');
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object' && ('light' in o || 'dark' in o)) {
        c.light = { ...emptySet(), ...(o.light || {}) };
        c.dark = { ...emptySet(), ...(o.dark || {}) };
      } else {
        // 兼容旧的扁平结构：视为亮色配置
        c.light = { ...emptySet(), ...o };
      }
    }
  } catch { /* 隐私模式下忽略 */ }
  return c;
}
function persistCustom(): void {
  try {
    localStorage.setItem('circlechat_styles', JSON.stringify(customStyles.value));
  } catch { /* 隐私模式下忽略 */ }
}

let customStyleEl: HTMLStyleElement | null = null;
function customStyleTag(): HTMLStyleElement {
  if (!customStyleEl) {
    customStyleEl = document.createElement('style');
    customStyleEl.id = 'circlechat-custom-styles';
    document.head.appendChild(customStyleEl);
  }
  return customStyleEl;
}

/** 被拒绝的自定义文字色（对比度过低），供弹窗提示 */
export const styleWarning = ref('');

function channelLinear(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = channelLinear((n >> 16) & 255);
  const g = channelLinear((n >> 8) & 255);
  const b = channelLinear(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
/** 当前主题生效的面板色（--panel），用于判断文字对比度 */
function effectivePanel(): string {
  try {
    const cs = getComputedStyle(document.documentElement);
    const pv = cs.getPropertyValue('--panel').trim();
    if (VALID_HEX.test(pv)) return pv;
  } catch {  }
  return '#202024';
}

/**
 * 应用当前主题的自定义配色（其余主题也各存一套但不应用）。
 * 文字色总会被应用；若与面板色对比度过低则写入 styleWarning 提示用户
 * （可读性偏弱），但不会把它丢弃或回退，避免出现“改了也无法使用”的卡死状态。
 */
export function applyCustom(): void {
  const active: ThemeName =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const s = customStyles.value[active];
  const panelRef = s.panel && VALID_HEX.test(s.panel) ? s.panel : effectivePanel();
  const text = s.text;
  styleWarning.value =
    text && VALID_HEX.test(text) && contrastRatio(text, panelRef) < 4.5 ? text : '';

  const pairs: Array<[string, string]> = [
    ['--bg', s.bg],
    ['--panel', s.panel],
    ['--text', text],
  ];
  const decls = pairs
    .filter(([, c]) => !!c && VALID_HEX.test(c))
    .map(([v, c]) => `${v}:${c}`)
    .join(';');
  customStyleTag().textContent = decls ? `html{${decls}}` : '';
}

export function setCustomPart(themeName: ThemeName, k: keyof StyleSet, hex: string): void {
  customStyles.value[themeName][k] = hex;
  persistCustom();
  applyCustom();
}

export function resetCustom(themeName: ThemeName): void {
  customStyles.value[themeName] = emptySet();
  persistCustom();
  applyCustom();
}

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

const DEFAULT_BRAND = '#07c160';

/** 手机浏览器状态栏颜色：跟随自定义强调色（未设置时用品牌绿） */
function syncThemeColor(): void {
  const m = document.querySelector('meta[name="theme-color"]');
  if (!m) return;
  const c = accent.value && /^#[0-9a-fA-F]{6}$/.test(accent.value) ? accent.value : DEFAULT_BRAND;
  m.setAttribute('content', c);
}

/** 应用自定义强调色：覆盖品牌/己方气泡色 */
export function applyAccent(c: string): void {
  const el = document.documentElement.style;
  if (!c || !/^#[0-9a-fA-F]{6}$/.test(c)) {
    el.removeProperty('--primary');
    el.removeProperty('--primary-dark');
    el.removeProperty('--self');
    syncThemeColor();
    return;
  }
  el.setProperty('--primary', c);
  el.setProperty('--primary-dark', shade(c, 0.15));
  el.setProperty('--self', c);
  syncThemeColor();
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
  applyCustom();
}

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
  applyCustom();
  applyAccent(accent.value);
  syncThemeColor();
}
