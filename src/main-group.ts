// 群管理页入口：群主本人或系统管理员可用；HTML 壳在 public/group.html。
import { createApp } from 'vue';
import AppGroup from './AppGroup.vue';
import { get } from './core/api';
import type { PresencePlatforms } from './core/presence';
import { initTheme } from './core/theme';
import { i18n } from './i18n';
import './styles/tailwind.css';
import './styles/fileview.css';

initTheme(); // 尽早应用主题，避免首屏闪白

get('/api/me')
  .then((j) => {
    if (!j.ok) {
      location.replace('/login.html');
      return;
    }
    createApp(AppGroup, {
      me: String(j.username || ''),
      isAdmin: j.role === 'admin',
      online: (j.online as string[]) || [],
      platforms: (j.platforms as PresencePlatforms) || {}
    }).use(i18n).mount('#app');
  })
  .catch(() => {
    location.replace('/login.html');
  });
