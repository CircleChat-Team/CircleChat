// CircleChat 前端 — 国际化桥接（基于 vue-i18n） 对外暴露 tr / trn / languages / setLang / langState， 旧代码里对 window.I18N 的调用全部被这里收口。

import { reactive, watch } from 'vue';
import { i18n, rawMessages, SUPPORTED } from '../i18n';
import type { LangItem } from '../types';

const STORAGE_KEY = 'circlechat_lang';

/** 语言状态：tick 触发依赖它的视图更新（切语言时自动重渲染） */
export const langState = reactive({
  lang: i18n.global.locale.value as string,
  tick: 0
});

// vue-i18n 对「动态拼接 key」的 t 类型推导会爆栈（TS2589），先转 any 再收窄为普通字符串函数
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vt = (i18n as any).global.t as (key: string, values?: Record<string, unknown>) => string;

watch(
  () => i18n.global.locale.value,
  (l) => {
    langState.lang = l;
    langState.tick++;
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : l;
  }
);

type Vars = Record<string, string | number>;

function pluralCategory(n: number): string {
  try {
    if (typeof Intl !== 'undefined' && Intl.PluralRules) {
      return new Intl.PluralRules(i18n.global.locale.value as string).select(n);
    }
  } catch {
    /* 老浏览器回退到英文规则 */
  }
  return n === 1 ? 'one' : 'other';
}

/**
 * 看起来像「翻译好的文本」而不像键名：真正的键只有 [a-z0-9.] 这类字符，
 * 不会出现空格或中日文。用来拦截 `tr('common.' + 已翻译文本)` 这种双重翻译
 * —— 那会让界面直接显示 `common.离线` 这样的键名（踩过两次）。
 */
function looksLikeText(key: string): boolean {
  return /[\s\u3000-\u9fff\uff00-\uffef]/.test(key);
}

/** 已经警告过的键：同一条只提醒一次，别刷控制台 */
const warnedKeys = new Set<string>();

/** 取文案（回退链：当前语言 → zh → key 本身） */
export function tr(key: string, vars?: Vars): string {
  void langState.tick; // 建立响应式依赖
  const out = vt(key, vars as Record<string, unknown>);
  if (out === key && looksLikeText(key) && !warnedKeys.has(key)) {
    warnedKeys.add(key);
    console.warn('[i18n] 疑似把“已经翻译好的文本”当成键传给了 tr()：' + key +
      '（presenceText / statusText 返回的就是文本，直接显示，不要再套 tr）');
  }
  return out;
}

/** 带复数的取文案：优先 key.<one|other> */
export function trn(key: string, n: number, vars?: Vars): string {
  void langState.tick;
  const cat = pluralCategory(n);
  const v = { n, ...(vars || {}) } as Record<string, unknown>;
  let s = vt(`${key}.${cat}`, v);
  if (s === `${key}.${cat}`) s = vt(`${key}.other`, v);
  if (s === `${key}.other`) s = vt(key, v);
  return s;
}

/** 已加载的语言列表（顺序按 SUPPORTED，name 取该语言自称，不翻译） */
export function languages(): LangItem[] {
  void langState.tick;
  return (SUPPORTED as readonly string[]).map((code) => ({
    code,
    name: (rawMessages[code] && rawMessages[code]['lang.name']) || code
  }));
}

export function setLang(code: string): void {
  if (!(SUPPORTED as readonly string[]).includes(code)) return;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* 忽略（隐私模式等） */
  }
  i18n.global.locale.value = code as 'zh' | 'en' | 'ja';
}
