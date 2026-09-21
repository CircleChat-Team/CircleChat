<script setup lang="ts">
/* ============================================================
 * 个人资料（自编辑弹窗）：弹窗外壳 —— 横向布局
 * 左栏：紧凑身份块（头像/昵称/处罚状态）+ 纵向 Tab 导航
 * 右栏：当前 Tab 内容（资料 / 安全 / 处罚）
 * 各编辑块已拆为独立子组件（profile/ 目录），此处负责弹层、
 * Tab 状态与处罚状态（供身份块与处罚列表共用）的统一拉取。
 * ============================================================ */
import { ref, computed, onMounted } from 'vue';
import { get } from '../../core/api';
import { tr } from '../../core/i18n';
import { chatState, closeMyProfile } from '../../core/chat';
import { useOverlay } from '../../core/useOverlay';
import ProfileHeader from './profile/ProfileHeader.vue';
import ProfileName from './profile/ProfileName.vue';
import ProfilePassword from './profile/ProfilePassword.vue';
import ProfileTwofa from './profile/ProfileTwofa.vue';
import ProfileOauth from './profile/ProfileOauth.vue';
import ProfilePenalty from './profile/ProfilePenalty.vue';
import type { PenaltyItem } from '../../types';

type TabKey = 'profile' | 'security' | 'penalty';
interface TabItem { k: TabKey; key: string; icon: string }
const ICON_PROFILE =
  'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z';
const ICON_SHIELD =
  'M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3zm-1.5 14.5-3-3 1.4-1.4 1.6 1.6 3.6-3.6 1.4 1.4-5 5z';
const ICON_GAVEL =
  'M12 3l7 2-1 5-6 4.5L6 10l-1-5 7-2zM6 13l1.5 5L12 22l.5-9-2 2.5L6 13zm12.5-3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z';
const tabs: TabItem[] = [
  { k: 'profile', key: 'profile.tab.profile', icon: ICON_PROFILE },
  { k: 'security', key: 'profile.tab.security', icon: ICON_SHIELD },
  { k: 'penalty', key: 'profile.tab.penalty', icon: ICON_GAVEL }
];
const activeTab = ref<TabKey>('profile');

// 处罚状态（身份块徽标 + 处罚列表共用，统一在打开时拉取一次）
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

// Esc 关闭 + 打开时聚焦弹层 + 关闭后归还焦点
const rootEl = ref<HTMLElement | null>(null);
useOverlay({
  isOpen: () => chatState.myProfileOpen,
  onClose: closeMyProfile,
  container: () => rootEl.value
});

onMounted(() => {
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
  <div
    v-if="chatState.myProfileOpen"
    ref="rootEl"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="closeMyProfile"
  >
    <div class="myprofile relative flex w-[38rem] max-h-[85vh] max-w-[95vw] overflow-hidden rounded-2xl bg-panel text-ink shadow-xl">

      <!-- 左栏：身份块 + 纵向 Tab 导航 -->
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

      <!-- 右栏：标题 + 内容 -->
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex items-center justify-between border-b border-line py-3 pl-5 pr-4">
          <span class="text-sm font-semibold">{{ tr(tabs.find((t) => t.k === activeTab)!.key) }}</span>
          <button
            type="button"
            class="text-2xl leading-none text-muted"
            :title="tr('common.close')"
            @click="closeMyProfile"
          >×</button>
        </div>

        <div class="max-h-[65vh] flex-1 overflow-y-auto p-5">
          <ProfileName v-if="activeTab === 'profile'" />
          <div v-else-if="activeTab === 'security'" class="space-y-5">
            <ProfilePassword />
            <ProfileTwofa />
            <ProfileOauth />
          </div>
          <ProfilePenalty v-else :penalties="penalties" :loading="penaltyLoading" />
        </div>
      </div>
    </div>
  </div>
</template>