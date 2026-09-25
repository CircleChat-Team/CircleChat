// 管理页入口：仅 role=admin，服务端与此处双重拦截。HTML 壳在 public/admin.html（URL 不变以保留服务端鉴权路径）。
import { createApp } from 'vue';
import AppAdmin from './AppAdmin.vue';
import { get } from './core/api';
import { initTheme } from './core/theme';
import { i18n } from './i18n';
import './styles/tailwind.css';

initTheme(); // 尽早应用主题，避免首屏闪白

get('/api/me')
  .then((j) => {
    if (!j.ok) {
      location.replace('/login.html');
      return;
    }
    if (j.role !== 'admin') {
      location.replace('/chat.html');
      return;
    }
    createApp(AppAdmin, { me: String(j.username || '') }).use(i18n).mount('#app');
  })
  .catch(() => {
    location.replace('/login.html');
  });
