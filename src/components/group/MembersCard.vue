<script setup lang="ts">
/* ============================================================
 * 群成员管理
 * ============================================================ */
import { inject } from 'vue';
import { post } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { confirm } from '../../core/dialog';
import { fmtDate } from '../../core/format';
import type { GroupMember } from '../../types';
import { presenceText, type PresencePlatforms } from '../../core/presence';

const props = defineProps<{
  gid: string;
  members: GroupMember[];
  online: string[];
  platforms: PresencePlatforms;
}>();

const emit = defineEmits<{ refreshed: [] }>();

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

function isOnline(name: string): boolean {
  return props.online.indexOf(name) !== -1;
}

/** 状态文案：与聊天页共用同一套判定；离线时显示「最后在线 x」 */
function statusText(m: GroupMember): string {
  return presenceText(isOnline(m.name), false, props.platforms[m.name], m.lastSeen);
}

function remove(m: GroupMember): void {
  confirm({
    title: tr('group.removeTitle'),
    text: tr('group.removeConfirm', { name: m.name }),
    okText: tr('group.remove')
  }).then((ok) => {
    if (!ok) return;
    post('/api/groups/members/remove', { gid: props.gid, name: m.name }).then((j) => {
      toast(j.ok ? tr('group.removed', { name: m.name }) : tr(j.error || 'common.opFailed'));
      if (j.ok) emit('refreshed');
    });
  });
}
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">
      {{ tr('group.members') }}
      <span class="font-normal">{{ trn('group.count.members', members.length) }}</span>
    </h2>

    <div class="flex flex-col gap-1.5">
      <p v-if="!members.length" class="py-2.5 text-center text-xs text-muted">{{ tr('group.membersEmpty') }}</p>

      <div
        v-for="m in members"
        :key="m.name"
        class="flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]"
      >
        <span class="min-w-0 flex-1 truncate font-medium">{{ m.name }}</span>
        <span v-if="m.owner" class="shrink-0 text-[11px] text-primary">{{ tr('group.ownerTag') }}</span>
        <span class="shrink-0 text-[11px]" :class="isOnline(m.name) ? 'text-primary' : 'text-muted'">
          {{ statusText(m) }}
        </span>
        <span class="shrink-0 text-[11px] text-muted">{{ fmtDate(m.joined) }}</span>
        <button
          v-if="!m.owner"
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
          @click="remove(m)"
        >
          {{ tr('group.remove') }}
        </button>
      </div>
    </div>
  </section>
</template>
