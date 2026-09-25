/// <reference types="vite/client" />

/* Vue 单文件组件类型声明（供 TS 识别 .vue 导入） */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

/* 部署配置（由 public/js/config.js 注入的全局） */
interface ChatConfig {
  apiBase: string;
  displayBase: string;
}

/* 桌面客户端注入的标记（类型与 src/utils/client.ts 的 DesktopClientInfo 对齐） */
interface DesktopClientMarker {
  version: string;
  platform: 'linux' | 'macos' | 'windows';
}

/* 桌面客户端提供的能力（见 src/utils/notify.ts） */
interface CircleChatNotifyOptions {
  title?: string;
  body?: string;
}

interface CircleChatNotifyResult {
  ok: boolean;
  error: string | null;
}

/** 窗口抖动结果：不在客户端里 / 客户端未实现该能力时为 { done: false } */
interface CircleChatShakeResult {
  done: boolean;
  error?: string | null;
}

interface Window {
  CHAT_CONFIG?: ChatConfig;
  __CIRCLECHAT_CLIENT__?: DesktopClientMarker;
  __CIRCLECHAT__?: {
    notify(options: CircleChatNotifyOptions | string): Promise<CircleChatNotifyResult>;
    /** 让客户端窗口抖一下抢注意力；老版本客户端可能没有这个方法，调用前要判存在 */
    shakeWindow?(): Promise<CircleChatShakeResult>;
  };
}
