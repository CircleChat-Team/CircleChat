/* ============================================================
 * ChatPlus 聊天页入口（Vue 3 + TypeScript + Tailwind）
 * 页面 HTML 在 public/chat.html，后端零改动（server.js 仍做会话鉴权）。
 * ============================================================ */

import { createApp } from 'vue';
import AppChat from './AppChat.vue';
import { initTheme } from './core/theme';
import { initChat } from './core/chat';
import './styles/tailwind.css';

initTheme(); // 尽早应用主题，避免首屏闪白
initChat(); // 鉴权 → 加载数据 → 建立 WebSocket
createApp(AppChat).mount('#app');
