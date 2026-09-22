import { createI18n } from 'vue-i18n';
import zh from './messages/zh';
import en from './messages/en';
import ja from './messages/ja';
import { nest, type Dict } from './nest';

export type { Dict };

/** 支持的语言（顺序即下拉框顺序）；'ja' 为标准语言码（源文件 jp.js 的遗留命名已在此统一） */
export const SUPPORTED = ['zh', 'en', 'ja'] as const;
type LangCode = (typeof SUPPORTED)[number];

const STORAGE_KEY = 'circlechat_lang';

function detectLocale(): LangCode {
  const saved = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  if (saved && (SUPPORTED as readonly string[]).includes(saved)) return saved as LangCode;

  const list = navigator.languages || [navigator.language || ''];
  for (const l of list) {
    const m = /^([a-z]{2,3})/i.exec(String(l).toLowerCase());
    if (m && (SUPPORTED as readonly string[]).includes(m[1])) return m[1] as LangCode;
  }
  return 'zh';
}

/** 原始扁平字典（供 languages() 取语言自称等） */
export const rawMessages: Record<string, Dict> = { zh, en, ja };

const messages = {
  zh: nest(zh),
  en: nest(en),
  ja: nest(ja)
};

const initial = detectLocale();
document.documentElement.lang = initial === 'zh' ? 'zh-CN' : initial;

export const i18n = createI18n({
  legacy: false,
  locale: initial,
  fallbackLocale: 'zh',
  messages
});
