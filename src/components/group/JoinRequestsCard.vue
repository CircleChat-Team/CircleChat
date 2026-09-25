<script setup lang="ts">
// 入群申请审核
import { inject } from 'vue';
import { post } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { confirm } from '../../core/dialog';
import { fmtDate } from '../../core/format';
import type { JoinRequest } from '../../types';

const props = defineProps<{
  gid: string;
  requests: JoinRequest[];
}>();

const emit = defineEmits<{ refreshed: [] }>();

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

function approve(r: JoinRequest): void {
  post('/api/groups/request/approve', { gid: props.gid, name: r.name }).then((j) => {
    toast(j.ok ? tr('group.approved', { name: r.name }) : tr(j.error || 'common.opFailed'));
    if (j.ok) emit('refreshed');
  });
}

function reject(r: JoinRequest): void {
  confirm({
    title: tr('group.rejectTitle'),
    text: tr('group.rejectConfirm', { name: r.name }),
    okText: tr('admin.reject.btn')
  }).then((ok) => {
    if (!ok) return;
    post('/api/groups/request/reject', { gid: props.gid, name: r.name }).then((j) => {
      toast(j.ok ? tr('group.rejected', { name: r.name }) : tr(j.error || 'common.opFailed'));
      if (j.ok) emit('refreshed');
    });
  });
}
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">
      {{ tr('group.requests') }}
      <span class="font-normal">{{ trn('admin.count.items', requests.length) }}</span>
    </h2>

    <div class="flex flex-col gap-1.5">
      <p v-if="!requests.length" class="py-2.5 text-center text-xs text-muted">{{ tr('group.requestsEmpty') }}</p>

      <div
        v-for="r in requests"
        :key="r.name"
        class="flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]"
      >
        <span class="min-w-0 flex-1 truncate font-medium">{{ r.name }}</span>
        <span class="shrink-0 text-[11px] text-muted">{{ tr('admin.created.at', { date: fmtDate(r.created) }) }}</span>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="approve(r)"
        >
          {{ tr('admin.approve.btn') }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
          @click="reject(r)"
        >
          {{ tr('admin.reject.btn') }}
        </button>
      </div>
    </div>
  </section>
</template>
