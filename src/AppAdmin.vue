<script setup lang="ts">
/* ============================================================
 * 管理页根组件
 * 顶栏（返回 / 语言 / 主题 / 退出）、卡片编排、全局轻提示。
 * ============================================================ */
import { ref, provide, watchEffect } from 'vue';
import { post } from './core/api';
import { tr } from './core/i18n';
import LangMenu from './components/common/LangMenu.vue';
import ThemeToggle from './components/common/ThemeToggle.vue';
import ApprovalsCard from './components/admin/ApprovalsCard.vue';
import UsersCard from './components/admin/UsersCard.vue';
import FilesCard from './components/admin/FilesCard.vue';
import LogsCard from './components/admin/LogsCard.vue';
import ModerationCard from './components/admin/ModerationCard.vue';
import OAuthCard from './components/admin/OAuthCard.vue';
import Dialog from './components/common/Dialog.vue';

const props = defineProps<{ me: string }>();

type ToastFn = (msg: string, ms?: number) => void;

const toastMsg = ref('');
let timer: number | undefined;

/** 全局轻提示：子组件 inject('toast') 调用 */
const toast: ToastFn = (msg, ms) => {
  toastMsg.value = msg;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    toastMsg.value = '';
  }, ms || 2500);
};
provide('toast', toast);

const tabs = [
  { id: 'approvals', label: 'admin.tab.approvals' },
  { id: 'users', label: 'admin.tab.users' },
  { id: 'moderation', label: 'admin.tab.moderation' },
  { id: 'files', label: 'admin.tab.files' },
  { id: 'oauth', label: 'admin.tab.oauth' },
  { id: 'logs', label: 'admin.tab.logs' }
];
const active = ref('approvals');

// tr 是响应式的，切语言时标题自动更新
watchEffect(() => {
  document.title = tr('admin.title');
});

function back(): void {
  location.href = '/chat.html';
}

function logout(): void {
  post('/api/logout', {}).catch(() => {
    /* 忽略 */
  });
  location.replace('/login.html');
}
</script>

<template>
  <div class="flex h-screen flex-col bg-bg text-ink">
    <header
      class="sticky top-0 z-5 flex h-14 items-center gap-2 border-b border-line bg-panel/80 px-4 backdrop-blur-xl"
    >
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-fill hover:text-ink"
          :title="tr('admin.back')"
          :aria-label="tr('admin.back')"
          @click="back"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <span class="whitespace-nowrap text-base font-semibold">{{ tr('chat.adminPanel') }}</span>
        <span class="min-w-0 truncate text-xs text-muted">{{ tr('admin.me.label', { name: me }) }}</span>
      </div>

      <div class="ml-auto flex shrink-0 items-center gap-2">
        <LangMenu />
        <ThemeToggle />
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-fill hover:text-danger"
          :title="tr('common.logout')"
          @click="logout"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
          </svg>
          <span>{{ tr('chat.logoutShort') }}</span>
        </button>
      </div>
    </header>

    <nav class="flex shrink-0 items-center gap-1 border-b border-line bg-panel/80 px-3 backdrop-blur-xl">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="relative -mb-px border-b-2 px-3 py-2.5 text-[13px] transition-colors"
        :class="active === t.id ? 'border-primary font-medium text-ink' : 'border-transparent text-muted hover:text-ink'"
        @click="active = t.id"
      >
        {{ tr(t.label) }}
      </button>
    </nav>

    <main class="min-h-0 flex-1 overflow-y-auto">
      <!-- 窄屏保持单列满宽；桌面端放宽，避免表格/列表两侧留大片空白 -->
      <div class="mx-auto max-w-190 px-4 py-5 pb-10 lg:max-w-[1120px] xl:max-w-[1400px]">
        <ApprovalsCard v-if="active === 'approvals'" />
        <UsersCard v-if="active === 'users'" :me="me" />
        <ModerationCard v-if="active === 'moderation'" />
        <FilesCard v-if="active === 'files'" />
        <OAuthCard v-if="active === 'oauth'" />
        <LogsCard v-if="active === 'logs'" />
      </div>
    </main>

    <div
      v-if="toastMsg"
      class="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink/90 px-4 py-2 text-sm text-panel shadow-lg"
      role="status"
      aria-live="polite"
    >
      {{ toastMsg }}
    </div>

    <Dialog />
  </div>
</template>
