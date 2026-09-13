<script setup lang="ts">
import { computed } from 'vue';
import { chatState, switchRoomToDm, closeProfile, avatarFor, avatarColor, isOnline } from '../../core/chat';
import { tr } from '../../core/i18n';
import { fmtDate } from '../../core/format';

const p = computed(() => chatState.profile);
function initial(n: string): string {
  return (n || '?').slice(0, 1);
}
function sendMsg(): void {
  if (p.value) {
    switchRoomToDm(p.value.name);
    closeProfile();
  }
}
</script>

<template>
  <div
    v-if="chatState.profileOpen && p"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="closeProfile"
  >
    <div class="relative w-80 max-w-full rounded-2xl bg-panel p-5 text-ink shadow-xl">
      <div class="flex flex-col items-center">
        <div class="h-20 w-20 overflow-hidden rounded-full">
          <img v-if="avatarFor(p.name)" :src="avatarFor(p.name)!" :alt="p.name" class="h-full w-full object-cover" />
          <div
            v-else
            class="flex h-full w-full items-center justify-center text-3xl font-semibold text-white"
            :style="{ background: avatarColor(p.name) }"
          >{{ initial(p.name) }}</div>
        </div>
        <div class="mt-3 text-lg font-semibold">{{ p.name }}</div>
        <div class="text-xs text-muted">{{ p.role === 'admin' ? tr('common.admin') : tr('common.user') }}</div>
      </div>
      <div class="mt-4 space-y-2 text-sm">
        <div class="flex justify-between">
          <span class="text-muted">{{ tr('chat.profile.status') }}</span>
          <b>{{ isOnline(p.name) ? tr('common.online') : tr('common.offline') }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-muted">{{ tr('chat.profile.joinedAt') }}</span>
          <b>{{ fmtDate(p.created) }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-muted">{{ tr('chat.profile.msgsLabel') }}</span>
          <b>{{ p.msgs ?? '—' }}</b>
        </div>
      </div>
      <button
        type="button"
        class="mt-5 w-full rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
        @click="sendMsg"
      >{{ tr('chat.profile.message') }}</button>
      <button
        type="button"
        class="absolute right-3 top-3 text-2xl leading-none text-muted"
        :title="tr('common.close')"
        @click="closeProfile"
      >×</button>
    </div>
  </div>
</template>
