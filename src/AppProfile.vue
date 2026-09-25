<script setup lang="ts">
/* ============================================================
 * 独立「个人资料 / 设置」页面（原为聊天页内的 MyProfile 弹窗）
 * 布局与管理面板(AppAdmin/AppGroup)保持一致：
 *   顶栏(返回/标题/语言/主题/退出) + 横向 Tab 导航 + 卡片内容区。
 * 页签：资料 / 安全 / API Key / 处罚。
 * ============================================================ */
import { computed, onMounted, ref, watchEffect } from 'vue';
import { get, post } from './core/api';
import { tr } from './core/i18n';
import LangMenu from './components/common/LangMenu.vue';
import ThemeToggle from './components/common/ThemeToggle.vue';
import ProfileHeader from './components/chat/profile/ProfileHeader.vue';
import ProfileName from './components/chat/profile/ProfileName.vue';
import ProfilePassword from './components/chat/profile/ProfilePassword.vue';
import ProfileTwofa from './components/chat/profile/ProfileTwofa.vue';
import ProfileOauth from './components/chat/profile/ProfileOauth.vue';
import ProfileApiKeys from './components/chat/profile/ProfileApiKeys.vue';
import ProfilePenalty from './components/chat/profile/ProfilePenalty.vue';
import type { PenaltyItem } from './types';

type TabKey = 'profile' | 'security' | 'apikey' | 'penalty';
const tabs = [
  { id: 'profile' as TabKey, label: 'profile.tab.profile' },
  { id: 'security' as TabKey, label: 'profile.tab.security' },
  { id: 'apikey' as TabKey, label: 'profile.tab.apikey' },
  { id: 'penalty' as TabKey, label: 'profile.tab.penalty' }
];
const active = ref<TabKey>('profile');

function initTab(): void {
  const t = new URLSearchParams(location.search).get('tab') || '';
  if (t === 'profile' || t === 'security' || t === 'apikey' || t === 'penalty') active.value = t;
}

// 处罚状态（身份块徽标 + 处罚列表共用）
const penalties = ref<PenaltyItem[]>([]);
const penaltyLoading = ref(true);
const penaltyStatus = ref<{ muted: boolean; banned: boolean; ipBanned: boolean } | null>(null);
const penaltySummary = computed(() => {
  const s = penaltyStatus.value;
  if (!s) return '';
  if (s.banned || s.ipBanned) return tr('mod.mine.banned');
  if (s.muted) return tr('mod.mine.muted');
  return tr('mod.mine.ok');
});
const penaltyBad = computed(() => {
  const ok = tr('mod.mine.ok');
  return penaltySummary.value !== '' && penaltySummary.value !== ok;
});

function back(): void {
  location.href = '/chat.html';
}

function logout(): void {
  post('/api/logout', {}).catch(() => {
  });
  location.replace('/login.html');
}

watchEffect(() => {
  document.title = tr('profile.title');
});

onMounted(() => {
  initTab();
  get('/api/me/penalties').then((j) => {
    if (j && j.ok) {
      penalties.value = (j.penalties as PenaltyItem[]) || [];
      penaltyStatus.value = (j.status as typeof penaltyStatus.value) || null;
    }
    penaltyLoading.value = false;
  }).catch(() => {
    penaltyLoading.value = false;
  });
});
</script>

<template>
  <div class="min-h-screen bg-bg text-ink">
    <header class="sticky top-0 z-5 flex h-14 items-center gap-2 border-b border-line bg-panel/80 px-4 backdrop-blur-xl">
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-fill hover:text-ink"
          :title="tr('admin.back')"
          :aria-label="tr('admin.back')"
          @click="back"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <span class="shrink-0 text-base font-semibold">{{ tr('profile.title') }}</span>
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

    <main class="mx-auto w-full max-w-190 px-4 py-5 pb-10 lg:max-w-[1120px] xl:max-w-[1400px]">
      <div v-if="active === 'profile'" class="space-y-4">
        <section class="rounded-card border border-line bg-panel p-4">
          <ProfileHeader :penalty-summary="penaltySummary" :penalty-bad="penaltyBad" />
        </section>
        <section class="rounded-card border border-line bg-panel p-4">
          <ProfileName />
        </section>
      </div>

      <div v-else-if="active === 'security'" class="space-y-4">
        <section class="rounded-card border border-line bg-panel p-4">
          <ProfilePassword />
        </section>
        <section class="rounded-card border border-line bg-panel p-4">
          <ProfileTwofa />
        </section>
        <section class="rounded-card border border-line bg-panel p-4">
          <ProfileOauth />
        </section>
      </div>

      <section v-else-if="active === 'apikey'" class="rounded-card border border-line bg-panel p-4">
        <ProfileApiKeys />
      </section>

      <section v-else class="rounded-card border border-line bg-panel p-4">
        <ProfilePenalty :penalties="penalties" :loading="penaltyLoading" />
      </section>
    </main>
  </div>
</template>
