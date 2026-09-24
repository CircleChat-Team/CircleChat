<script setup lang="ts">
/* ============================================================
 * 群邀请审批（群管理页）
 * 管理者查看「需审批」的邀请并批准/拒绝；同时展示待对方接受的邀请。
 * ============================================================ */
import { inject } from 'vue';
import { tr } from '../../core/i18n';
import { approveInvite, rejectInvite } from '../../core/chat';
import type { GroupInvite } from '../../types';

const props = defineProps<{
  gid: string;
  invites: GroupInvite[];
}>();

const emit = defineEmits<{ refreshed: [] }>();

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

const approvals = (): GroupInvite[] => props.invites.filter((i) => i.status === 'needs_approval');
const pending = (): GroupInvite[] => props.invites.filter((i) => i.status === 'pending');

function doApprove(i: GroupInvite): void {
  approveInvite(i.id).then((j) => {
    toast(j.ok ? tr('group.inviteApprove') + '：' + i.invitee : tr(j.error || 'common.opFailed'));
    if (j.ok) emit('refreshed');
  });
}
function doReject(i: GroupInvite): void {
  rejectInvite(i.id).then((j) => {
    toast(j.ok ? tr('group.inviteReject') + '：' + i.invitee : tr(j.error || 'common.opFailed'));
    if (j.ok) emit('refreshed');
  });
}
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">{{ tr('group.inviteApprovals') }}</h2>

    <div v-if="!invites.length" class="py-2.5 text-center text-xs text-muted">{{ tr('group.inviteEmpty') }}</div>

    <template v-else>
      <p v-if="!approvals().length" class="mb-2 text-xs text-muted">{{ tr('group.inviteEmpty') }}</p>
      <div v-for="i in approvals()" :key="'a' + i.id" class="mb-2 flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]">
        <span class="min-w-0 flex-1 truncate">
          <span class="font-medium">{{ i.invitee }}</span>
          <span class="ml-1 text-[11px] text-muted">{{ tr('group.inviteStatusApproval') }}（{{ tr('group.inviteFrom', { name: i.inviter }) }}）</span>
        </span>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="doApprove(i)"
        >{{ tr('group.inviteApprove') }}</button>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
          @click="doReject(i)"
        >{{ tr('group.inviteReject') }}</button>
      </div>

      <p v-if="pending().length" class="mt-3 mb-1 text-[11px] text-muted">{{ tr('group.inviteStatusPending') }}</p>
      <div v-for="i in pending()" :key="'p' + i.id" class="flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]">
        <span class="min-w-0 flex-1 truncate text-muted">
          {{ i.invitee }}<span class="ml-1 text-[11px]">← {{ i.inviter }}</span>
        </span>
      </div>
    </template>
  </section>
</template>
