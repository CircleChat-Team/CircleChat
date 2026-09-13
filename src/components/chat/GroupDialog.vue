<script setup lang="ts">
import { ref, computed } from 'vue';
import { chatState, groupCreate, groupJoin, groupSearch } from '../../core/chat';
import { tr } from '../../core/i18n';
import type { ChatGroup } from '../../types';

const name = ref('');
const kw = ref('');
const results = ref<ChatGroup[]>([]);

const tab = computed(() => chatState.groupDialogTab);

async function create(): Promise<void> {
  const n = name.value.trim();
  if (!n) return;
  await groupCreate(n);
  close();
}
async function doSearch(): Promise<void> {
  const k = kw.value.trim();
  if (!k) return;
  results.value = await groupSearch(k);
}
async function join(g: ChatGroup): Promise<void> {
  await groupJoin(g.id);
  close();
}
function close(): void {
  chatState.groupDialogOpen = false;
  name.value = '';
  kw.value = '';
  results.value = [];
}
</script>

<template>
  <div
    v-if="chatState.groupDialogOpen"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    @click.self="close"
  >
    <div class="relative w-96 max-w-full rounded-2xl bg-panel p-5 text-ink shadow-xl">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-base font-semibold">{{ tr('chat.group.dialog') }}</span>
        <button type="button" class="text-2xl leading-none text-muted" :title="tr('common.close')" @click="close">×</button>
      </div>
      <div class="mb-3 flex gap-2">
        <button
          type="button"
          :class="['flex-1 rounded-lg py-2 text-sm', tab === 'create' ? 'bg-primary text-white' : 'bg-fill text-muted']"
          @click="chatState.groupDialogTab = 'create'"
        >{{ tr('chat.group.create') }}</button>
        <button
          type="button"
          :class="['flex-1 rounded-lg py-2 text-sm', tab === 'search' ? 'bg-primary text-white' : 'bg-fill text-muted']"
          @click="chatState.groupDialogTab = 'search'"
        >{{ tr('chat.group.join') }}</button>
      </div>

      <div v-if="tab === 'create'" class="space-y-2">
        <input
          v-model="name"
          type="text"
          :placeholder="tr('chat.group.namePlaceholder')"
          maxlength="24"
          class="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm outline-none focus:border-primary"
          @keyup.enter="create"
        />
        <button type="button" class="w-full rounded-lg bg-primary py-2 text-sm text-white" @click="create">
          {{ tr('chat.group.create') }}
        </button>
      </div>

      <div v-else class="space-y-2">
        <div class="flex gap-2">
          <input
            v-model="kw"
            type="text"
            :placeholder="tr('chat.group.searchPlaceholder')"
            maxlength="24"
            class="flex-1 rounded-lg border border-line bg-fill px-3 py-2 text-sm outline-none focus:border-primary"
            @keyup.enter="doSearch"
          />
          <button type="button" class="rounded-lg bg-primary px-3 py-2 text-sm text-white" @click="doSearch">
            {{ tr('chat.group.search') }}
          </button>
        </div>
        <div class="space-y-2">
          <div
            v-for="g in results"
            :key="g.id"
            class="flex items-center justify-between rounded-lg bg-fill px-3 py-2 text-sm"
          >
            <span>{{ g.name }} <i class="text-xs text-muted">{{ tr('chat.group.owner', { name: g.owner }) }}</i></span>
            <button type="button" class="rounded-md bg-primary px-2 py-1 text-xs text-white" @click="join(g)">
              {{ tr('chat.group.join') }}
            </button>
          </div>
          <p v-if="kw && !results.length" class="text-center text-xs text-muted">{{ tr('chat.group.none') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
