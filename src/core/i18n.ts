/* ============================================================
 * CircleChat 前端 — 国际化桥接
 *
 * window.I18N 是命令式的（切语言要手动刷新各列表），这里包成
 * 响应式：模板里调用 tr() 会自动建立依赖，切语言后自动重渲染。
 * ============================================================ */

import { reactive } from 'vue';
import type { LangItem } from '../types';

const I18N = window.I18N;

/** 语言状态：tick 触发依赖它的视图更新 */
export const langState = reactive({
  lang: I18N ? I18N.current() : 'zh',
  tick: 0
});

if (I18N) {
  I18N.onChange(() => {
    langState.lang = I18N.current();
    langState.tick++;
  });
}

type Vars = Record<string, string | number>;

export function tr(key: string, vars?: Vars): string {
  void langState.tick; // 建立响应式依赖
  return I18N ? I18N.t(key, vars) : key;
}

export function trn(key: string, n: number, vars?: Vars): string {
  void langState.tick;
  return I18N ? I18N.tn(key, n, vars) : key;
}

export function languages(): LangItem[] {
  void langState.tick;
  return I18N ? I18N.languages() : [];
}

export function setLang(code: string): void {
  if (I18N) I18N.set(code);
}
