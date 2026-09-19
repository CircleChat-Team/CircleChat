<script setup lang="ts">
import { ref } from 'vue';
import { chatState, friendRequest } from '../../core/chat';
import { get } from '../../core/api';
import { tr } from '../../core/i18n';
import { useOverlay } from '../../core/useOverlay';
import type { ChatUser } from '../../types';

const q = ref('');
const results = ref<ChatUser[]>([]);
const sent = ref<string | null>(null);

async function search(): Promise<void> {
  const kw = q.value.trim();
  if (!kw) return;
  const j = await get('/api/users?q=' + encodeURIComponent(kw));
  results.value = (j.ok ? (j.users as ChatUser[]) : []) || [];
}
async function add(name: string): Promise<void> {
  await friendRequest(name);
  sent.value = name;
}
function close(): void {
  chatState.friendSearchOpen = false;
  q.value = '';
  results.value = [];
  sent.value = null;
}

// Esc 关闭 + 打开时聚焦弹层 + 关闭后归还焦点
const rootEl = ref<HTMLElement | null>(null);
useOverlay({
  isOpen: () => chatState.friendSearchOpen,
  onClose: close,
  container: () => rootEl.value
});
</script>

<template>
  <div
    v-if="chatState.friendSearchOpen"
    ref="rootEl"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="close"
  >
    <div class="relative w-96 max-w-full rounded-2xl bg-panel p-5 text-ink shadow-xl">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-base font-semibold">{{ tr('chat.friend.add') }}</span>
        <button type="button" class="text-2xl leading-none text-muted" :title="tr('common.close')" @click="close">×</button>
      </div>
      <div class="flex gap-2">
        <input
          v-model="q"
          type="text"
          :placeholder="tr('chat.friend.searchPlaceholder')"
          maxlength="64"
          class="flex-1 rounded-lg border border-line bg-fill px-3 py-2 text-sm outline-none focus:border-primary"
          @keyup.enter="search"
        />
        <button type="button" class="rounded-lg bg-primary px-3 py-2 text-sm text-white" @click="search">
          {{ tr('chat.friend.search') }}
        </button>
      </div>
      <p class="mt-2 text-xs text-muted">{{ tr('chat.friend.tip') }}</p>
      <div class="mt-3 space-y-2">
        <div
          v-for="u in results"
          :key="u.name"
          class="flex items-center justify-between rounded-lg bg-fill px-3 py-2 text-sm"
        >
          <span>{{ u.name }}</span>
          <button
            v-if="sent !== u.name"
            type="button"
            class="rounded-md bg-primary px-2 py-1 text-xs text-white"
            @click="add(u.name)"
          >{{ tr('chat.friend.add') }}</button>
          <span v-else class="text-xs text-primary">{{ tr('chat.friend.sent', { name: u.name }) }}</span>
        </div>
        <p v-if="q && !results.length" class="text-center text-xs text-muted">{{ tr('chat.friend.notFound') }}</p>
      </div>
    </div>
  </div>
</template>
