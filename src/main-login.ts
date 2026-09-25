// 登录页入口；HTML 壳在 public/login.html。
import { createApp } from 'vue';
import AppLogin from './AppLogin.vue';
import { get } from './core/api';
import { initTheme } from './core/theme';
import { redirectAfterLogin } from './core/nav';
import { i18n } from './i18n';
import './styles/tailwind.css';

initTheme(); // 尽早应用主题，避免首屏闪白

createApp(AppLogin).use(i18n).mount('#app');

// 已登录则直接进入（放在挂载之后，避免拦截首屏渲染）
get('/api/me')
  .then((j) => {
    if (j.ok) redirectAfterLogin();
  })
  .catch(() => {
  });
