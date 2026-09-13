/// <reference types="vite/client" />

/* Vue 单文件组件类型声明（供 TS 识别 .vue 导入） */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

/* 现有全局脚本（非模块）的类型占位 */
interface ChatConfig {
  apiBase: string;
  displayBase: string;
}

interface I18NLike {
  t(key: string, vars?: Record<string, string | number>): string;
  tn(key: string, n: number, vars?: Record<string, string | number>): string;
  current(): string;
  languages(): Array<{ code: string; name: string }>;
  set(code: string): void;
  onChange(fn: () => void): void;
  apply(): void;
}

interface UILike {
  confirm(opts: {
    title?: string;
    text?: string;
    okText?: string;
    danger?: boolean;
  }): Promise<boolean>;
  prompt(opts: {
    title?: string;
    text?: string;
    placeholder?: string;
    okText?: string;
    danger?: boolean;
    input?: { type?: string; placeholder?: string; maxLength?: number; value?: string };
  }): Promise<string | null>;
}

interface Window {
  CHAT_CONFIG?: ChatConfig;
  I18N?: I18NLike;
  UI?: UILike;
}
