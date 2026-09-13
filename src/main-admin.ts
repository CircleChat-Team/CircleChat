/* ============================================================
 * CircleChat 管理页入口
 *
 * 仅 role=admin 可访问：非管理员会被服务端与此处双重拦截。
 * 页面 HTML 仍在 public/admin.html（保持 URL 与服务端鉴权路径不变）。
 * ============================================================ */

import { createApp } from 'vue';
import AppAdmin from './AppAdmin.vue';
import { get } from './core/api';
import { initTheme } from './core/theme';
import './styles/tailwind.css';

initTheme(); // 尽早应用主题，避免首屏闪白

get('/api/me')
  .then((j) => {
    if (!j.ok) {
      location.replace('/login.html');
      return;
    }
    if (j.role !== 'admin') {
      location.replace('/chat.html'); // 非管理员不可进
      return;
    }
    createApp(AppAdmin, { me: String(j.username || '') }).mount('#app');
  })
  .catch(() => {
    location.replace('/login.html');
  });
