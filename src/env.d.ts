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

interface Window {
  CHAT_CONFIG?: ChatConfig;
  __CIRCLECHAT_CLIENT__?: DesktopClientMarker;
}
