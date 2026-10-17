// 聊天页入口；HTML 壳在 public/chat.html，会话鉴权仍在服务端。
import { createApp } from 'vue';
import AppChat from './AppChat.vue';
import { initTheme } from './core/theme';
import { initChat } from './core/chat';
import { i18n } from './i18n';
import './styles/tailwind.css';
import './styles/chat.css';
// 按钮样式按「界面功能区」分块独立维护（每个块自包含，改一块不波及其它块）
import './styles/buttons.css';
import './styles/fileview.css';

initTheme(); // 尽早应用主题，避免首屏闪白
initChat(); // 鉴权 → 加载数据 → 建立 WebSocket
createApp(AppChat).use(i18n).mount('#app');
