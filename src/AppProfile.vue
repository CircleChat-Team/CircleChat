<script setup lang="ts">
/* ============================================================
 * 独立「个人资料 / 设置」页面（原为聊天页内的 MyProfile 弹窗）
 * 左栏：身份块 + 纵向 Tab 导航；右栏：当前 Tab 内容。
 * 页签：资料 / 安全 / API Key / 处罚。
 * ============================================================ */
import { computed, onMounted, ref } from 'vue';
import { get } from './core/api';
import { tr } from './core/i18n';
import ThemeToggle from './components/common/ThemeToggle.vue';
import LangMenu from './components/common/LangMenu.vue';
import ProfileHeader from './components/chat/profile/ProfileHeader.vue';
import ProfileName from './components/chat/profile/ProfileName.vue';
import ProfilePassword from './components/chat/profile/ProfilePassword.vue';
import ProfileTwofa from './components/chat/profile/ProfileTwofa.vue';
import ProfileOauth from './components/chat/profile/ProfileOauth.vue';
import ProfileApiKeys from './components/chat/profile/ProfileApiKeys.vue';
import ProfilePenalty from './components/chat/profile/ProfilePenalty.vue';
import type { PenaltyItem } from './types';

type TabKey = 'profile' | 'security' | 'apikey' | 'penalty';
interface TabItem { k: TabKey; key: string; icon: string }
const ICON_PROFILE =
  'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z';
const ICON_SHIELD =
  'M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3zm-1.5 14.5-3-3 1.4-1.4 1.6 1.6 3.6-3.6 1.4 1.4-5 5z';
const ICON_KEY =
  'M12.65 10A6 6 0 1 0 7 16a5.96 5.96 0 0 0 4-1.53V17l2 2h2v2h2v-2h2v-2.35A6 6 0 0 0 17 10.35V10zM7 12a2 2 0 1 1 2-2 2 2 0 0 1-2 2z';
const ICON_GAVEL =
  'M12 3l7 2-1 5-6 4.5L6 10l-1-5 7-2zM6 13l1.5 5L12 22l.5-9-2 2.5L6 13zm12.5-3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z';
const tabs: TabItem[] = [
  { k: 'profile', key: 'profile.tab.profile', icon: ICON_PROFILE },
  { k: 'security', key: 'profile.tab.security', icon: ICON_SHIELD },
  { k: 'apikey', key: 'profile.tab.apikey', icon: ICON_KEY },
  { k: 'penalty', key: 'profile.tab.penalty', icon: ICON_GAVEL }
];

const activeTab = ref<TabKey>('profile');

function initTab(): void {
  const t = new URLSearchParams(location.search).get('tab') || '';
  if (t === 'profile' || t === 'security' || t === 'apikey' || t === 'penalty') activeTab.value = t;
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
    <header class="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-panel/80 px-4 backdrop-blur-xl">
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
      <span class="text-base font-semibold">{{ tr('profile.title') }}</span>
      <div class="ml-auto flex items-center gap-2">
        <LangMenu />
        <ThemeToggle />
      </div>
    </header>

    <main class="mx-auto w-full max-w-190 px-4 py-5">
      <div class="flex overflow-hidden rounded-2xl border border-line bg-panel">
        <!-- 左栏：身份块 + 纵向 Tab -->
        <aside class="flex w-36 shrink-0 flex-col border-r border-line bg-fill/60 p-3">
          <ProfileHeader :penalty-summary="penaltySummary" :penalty-bad="penaltyBad" />
          <nav class="mt-4 flex flex-col gap-1">
            <button
              v-for="t in tabs"
              :key="t.k"
              type="button"
              class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
              :class="activeTab === t.k ? 'bg-primary/12 font-semibold text-primary' : 'text-muted hover:bg-fill'"
              @click="activeTab = t.k"
            >
              <svg class="h-4.5 w-4.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path :d="t.icon" />
              </svg>
              <span>{{ tr(t.key) }}</span>
            </button>
          </nav>
        </aside>

        <!-- 右栏：内容 -->
        <div class="flex min-w-0 flex-1 flex-col">
          <div class="border-b border-line px-5 py-3">
            <span class="text-sm font-semibold">{{ tr(tabs.find((t) => t.k === activeTab)!.key) }}</span>
          </div>
          <div class="min-h-[60vh] flex-1 p-5">
            <ProfileName v-if="activeTab === 'profile'" />
            <div v-else-if="activeTab === 'security'" class="space-y-5">
              <ProfilePassword />
              <ProfileTwofa />
              <ProfileOauth />
            </div>
            <ProfileApiKeys v-else-if="activeTab === 'apikey'" />
            <ProfilePenalty v-else :penalties="penalties" :loading="penaltyLoading" />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
