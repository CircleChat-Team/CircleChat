<script setup lang="ts">
/* ============================================================
 * 群成员管理（群管理页）
 * 群主可设/取消管理员、禁言、移除；管理员可禁言、移除普通成员。
 * ============================================================ */
import { inject } from 'vue';
import { tr, trn } from '../../core/i18n';
import { confirm } from '../../core/dialog';
import { fmtDate } from '../../core/format';
import { setMemberRole, muteMember } from '../../core/chat';
import type { GroupMember } from '../../types';
import { presenceText, type PresencePlatforms } from '../../core/presence';

const props = defineProps<{
  gid: string;
  members: GroupMember[];
  online: string[];
  platforms: PresencePlatforms;
  isOwner: boolean;
  isManager: boolean;
  me: string;
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
    fetch('/api/groups/members/remove', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gid: props.gid, name: m.name })
    }).then((r) => r.json()).then((j) => {
      toast(j.ok ? tr('group.removed', { name: m.name }) : tr(j.error || 'common.opFailed'));
      if (j.ok) emit('refreshed');
    });
  });
}

function toggleAdmin(m: GroupMember): void {
  const role = m.role === 'admin' ? 'member' : 'admin';
  setMemberRole(props.gid, m.name, role).then((j) => {
    toast(j.ok ? tr(role === 'admin' ? 'group.setAdmin' : 'group.removeAdmin') + '：' + m.name : tr(j.error || 'common.opFailed'));
    if (j.ok) emit('refreshed');
  });
}

function toggleMute(m: GroupMember): void {
  muteMember(props.gid, m.name, !m.muted).then((j) => {
    toast(j.ok ? tr(m.muted ? 'group.unmuteMember' : 'group.muteMember') + '：' + m.name : tr(j.error || 'common.opFailed'));
    if (j.ok) emit('refreshed');
  });
}

/** 可管理对象：管理者、非群主、非自己、非管理员（管理员只能由群主操作） */
function canManage(m: GroupMember): boolean {
  return props.isManager && !m.owner && m.name !== props.me && m.role !== 'admin';
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
        class="flex flex-wrap items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]"
      >
        <span class="min-w-0 flex-1 truncate font-medium">
          {{ m.nickname || m.name }}<span v-if="m.nickname" class="ml-1 text-[11px] text-muted">({{ m.name }})</span>
        </span>
        <span v-if="m.owner" class="shrink-0 text-[11px] text-primary">{{ tr('group.ownerTag') }}</span>
        <span v-else-if="m.role === 'admin'" class="shrink-0 text-[11px] text-warn">{{ tr('group.roleAdmin') }}</span>
        <span v-if="m.muted" class="shrink-0 text-[11px] text-danger">{{ tr('group.memberMuted') }}</span>
        <span class="shrink-0 text-[11px]" :class="isOnline(m.name) ? 'text-primary' : 'text-muted'">
          {{ statusText(m) }}
        </span>
        <span class="shrink-0 text-[11px] text-muted">{{ fmtDate(m.joined) }}</span>

        <template v-if="canManage(m)">
          <button
            v-if="isOwner"
            type="button"
            class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
            @click="toggleAdmin(m)"
          >
            {{ m.role === 'admin' ? tr('group.removeAdmin') : tr('group.setAdmin') }}
          </button>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
            @click="toggleMute(m)"
          >
            {{ m.muted ? tr('group.unmuteMember') : tr('group.muteMember') }}
          </button>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
            @click="remove(m)"
          >
            {{ tr('group.remove') }}
          </button>
        </template>
      </div>
    </div>
  </section>
</template>
