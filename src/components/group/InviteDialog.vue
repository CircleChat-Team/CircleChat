<script setup lang="ts">
/* ============================================================
 * 邀请成员入群：从好友 / 其他群成员中挑选，或直接输入用户名。
 * 邀请是否需要对方同意 / 群主审批，由服务端按设置决定。
 * ============================================================ */
import { onMounted, ref, computed } from 'vue';
import { get } from '../../core/api';
import { tr } from '../../core/i18n';
import { inviteToGroup, chatState } from '../../core/chat';

const props = defineProps<{ gid: string }>();
const emit = defineEmits<{ close: [] }>();

const keyword = ref('');
const friends = ref<string[]>([]);
const others = ref<string[]>([]);
const busy = ref(false);
const msg = ref('');

const meMembers = computed(() => chatState.activeGroupMembers.map((m) => m.name));

function invite(name: string): void {
  const v = (name || '').trim();
  if (!v) return;
  busy.value = true;
  inviteToGroup(props.gid, v).then((j) => {
    busy.value = false;
    if (!j.ok) {
      msg.value = tr(j.error || 'common.opFailed');
      return;
    }
    if (j.autoJoined) msg.value = tr('group.inviteAutoJoined');
    else if (j.status === 'needs_approval') msg.value = tr('group.inviteNeedApproval');
    else msg.value = tr('group.inviteSent');
    // 邀请成功后从候选里移除，避免重复点击
    friends.value = friends.value.filter((n) => n !== v);
    others.value = others.value.filter((n) => n !== v);
  }).catch(() => {
    busy.value = false;
    msg.value = tr('common.opFailed');
  });
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const hit = (n: string): boolean => !kw || n.toLowerCase().indexOf(kw) !== -1;
  return {
    friends: friends.value.filter(hit),
    others: others.value.filter(hit)
  };
});

onMounted(() => {
  get('/api/friends').then((j) => {
    if (j && j.ok) {
      friends.value = ((j.friends as { name: string }[]) || [])
        .map((f) => f.name)
        .filter((n) => meMembers.value.indexOf(n) === -1);
    }
  });
  // 其他群的成员：拉我的群列表，再逐个拉成员，聚合去重
  get('/api/groups').then((j) => {
    if (!j || !j.ok) return;
    const gids = ((j.groups as { id: string }[]) || []).map((g) => g.id).filter((id) => id !== props.gid);
    Promise.all(gids.map((id) => get('/api/groups/members?gid=' + encodeURIComponent(id))))
      .then((res) => {
        const set = new Set<string>();
        for (const r of res) {
          if (!r || !r.ok) continue;
          for (const m of (r.members as { name: string }[]) || []) {
            const n = m.name;
            if (n !== chatState.me && meMembers.value.indexOf(n) === -1) set.add(n);
          }
        }
        others.value = Array.from(set).sort();
      })
      .catch(() => { /* 忽略 */ });
  });
});
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="flex max-h-[80vh] w-full max-w-md flex-col rounded-card border border-line bg-panel p-4 shadow-lg">
      <header class="mb-3 flex items-center gap-2">
        <h2 class="text-sm font-semibold">{{ tr('group.inviteTitle') }}</h2>
        <button type="button" class="ml-auto text-lg text-muted hover:text-ink" @click="emit('close')">×</button>
      </header>

      <div class="flex items-center gap-2">
        <input
          v-model="keyword"
          type="text"
          maxlength="64"
          class="h-8 min-w-0 flex-1 rounded-lg border border-line bg-fill px-2.5 text-xs outline-none transition-colors focus:border-primary"
          :placeholder="tr('group.invitePlaceholder')"
          @keydown.enter.prevent="invite(keyword)"
        >
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
          :disabled="busy"
          @click="invite(keyword)"
        >{{ tr('group.invite') }}</button>
      </div>

      <p v-if="msg" class="mt-2 text-xs text-primary">{{ msg }}</p>

      <div class="mt-3 min-h-0 flex-1 overflow-y-auto">
        <template v-if="filtered.friends.length">
          <p class="mb-1 text-[11px] text-muted">{{ tr('group.inviteFromFriends') }}</p>
          <button
            v-for="n in filtered.friends"
            :key="'f' + n"
            type="button"
            class="mb-1 flex w-full items-center gap-2 rounded-lg bg-fill px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-fill/70"
            @click="invite(n)"
          >
            <span class="min-w-0 flex-1 truncate font-medium">{{ n }}</span>
            <span class="shrink-0 text-[11px] text-primary">{{ tr('group.invite') }}</span>
          </button>
        </template>

        <template v-if="filtered.others.length">
          <p class="mt-2 mb-1 text-[11px] text-muted">{{ tr('group.inviteFromGroups') }}</p>
          <button
            v-for="n in filtered.others"
            :key="'o' + n"
            type="button"
            class="mb-1 flex w-full items-center gap-2 rounded-lg bg-fill px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-fill/70"
            @click="invite(n)"
          >
            <span class="min-w-0 flex-1 truncate font-medium">{{ n }}</span>
            <span class="shrink-0 text-[11px] text-primary">{{ tr('group.invite') }}</span>
          </button>
        </template>

        <p v-if="!filtered.friends.length && !filtered.others.length" class="py-4 text-center text-xs text-muted">
          {{ tr('group.inviteEmpty') }}
        </p>
      </div>
    </div>
  </div>
</template>
