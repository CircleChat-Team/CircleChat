<script setup lang="ts">
/* ============================================================
 * 个人资料 - 左列身份块：小号头像（hover 相机角标换图）/ 昵称 / 处罚状态
 * 供横向布局的左栏顶部使用，整体紧凑。
 * ============================================================ */
import { ref, computed } from 'vue';
import { tr } from '../../../core/i18n';
import { chatState, avatarFor, avatarColor, updateAvatar, clearAvatar } from '../../../core/chat';

defineProps<{
  penaltySummary: string;
  penaltyBad: boolean;
}>();

const initial = (n: string): string => (n || '?').slice(0, 1);
const avatarSrc = computed(() => avatarFor(chatState.me));

const uploading = ref(false);
const avatarMsg = ref('');

function onPickAvatar(e: Event): void {
  const file = (e.target as HTMLInputElement).files && (e.target as HTMLInputElement).files![0];
  if (!file) return;
  uploading.value = true;
  avatarMsg.value = '';
  updateAvatar(file).then((ok) => {
    uploading.value = false;
    avatarMsg.value = ok ? tr('profile.avatar.updated') : tr('common.opFailed');
    (e.target as HTMLInputElement).value = '';
  });
}
function onClearAvatar(): void {
  avatarMsg.value = '';
  clearAvatar().then((ok) => {
    avatarMsg.value = ok ? tr('profile.avatar.updated') : tr('common.opFailed');
  });
}
</script>

<template>
  <div class="flex flex-col items-center text-center">
    <!-- 小号头像：hover 显示相机角标换图 -->
    <label class="group relative h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-full ring-1 ring-line">
      <img v-if="avatarSrc" :src="avatarSrc!" :alt="chatState.me" class="h-full w-full object-cover" />
      <div v-else class="flex h-full w-full items-center justify-center text-xl font-semibold text-white" :style="{ background: avatarColor(chatState.me) }">
        {{ initial(chatState.me) }}
      </div>
      <span class="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9.4 3 7.8 4.8H4a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6.8a2 2 0 0 0-2-2h-3.8L14.6 3H9.4zM12 17.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-2a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
        </svg>
      </span>
      <input type="file" accept="image/*" class="hidden" @change="onPickAvatar" />
    </label>

    <div class="mt-2 w-full truncate text-sm font-semibold">{{ chatState.me }}</div>
    <span
      :class="penaltyBad ? 'bg-danger/12 text-danger' : 'bg-primary/12 text-primary'"
      class="mt-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
    >{{ penaltySummary }}</span>

    <div v-if="uploading || avatarMsg || avatarSrc" class="mt-1 flex items-center gap-2">
      <span v-if="uploading" class="text-[10px] text-muted">…</span>
      <p v-else-if="avatarMsg" class="text-[10px] text-success">{{ avatarMsg }}</p>
      <button
        v-else-if="avatarSrc"
        type="button"
        class="text-[10px] text-muted underline"
        @click="onClearAvatar"
      >{{ tr('profile.avatar.clear') }}</button>
    </div>
  </div>
</template>