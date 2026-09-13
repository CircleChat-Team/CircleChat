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

interface Window {
  CHAT_CONFIG?: ChatConfig;
}
