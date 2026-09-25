/* ============================================================
 * CircleChat 个人资料 / 设置页入口（Vue 3 + TypeScript + Tailwind）
 * 页面 HTML 在 public/profile.html。原为聊天页内的 MyProfile 弹窗，现独立成页。
 * ============================================================ */

import { createApp } from 'vue';
import AppProfile from './AppProfile.vue';
import { bootProfilePage } from './core/chat';
import { initTheme } from './core/theme';
import { i18n } from './i18n';
import './styles/tailwind.css';

initTheme(); // 尽早应用主题，避免首屏闪白

bootProfilePage().then((ok) => {
  if (!ok) return; // 未登录已跳登录页
  createApp(AppProfile).use(i18n).mount('#app');
});
