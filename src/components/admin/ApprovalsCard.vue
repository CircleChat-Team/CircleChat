<script setup lang="ts">
// 待审核注册申请
import { ref, inject, onMounted } from 'vue';
import { get, post } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { fmtDate } from '../../core/format';
import type { ApprovalItem } from '../../types';

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

const items = ref<ApprovalItem[]>([]);
const failed = ref('');

function load(): void {
  get('/api/admin/approvals')
    .then((j) => {
      if (!j.ok) {
        failed.value = j.error || 'common.loadFailed';
        items.value = [];
        return;
      }
      failed.value = '';
      items.value = (j.approvals as ApprovalItem[]) || [];
    })
    .catch(() => {
      failed.value = 'common.loadFailed';
      items.value = [];
    });
}

function approve(a: ApprovalItem): void {
  post('/api/admin/review/approve', { name: a.name }).then((j) => {
    toast(j.ok ? tr('admin.approved', { name: a.name }) : tr(j.error || 'common.opFailed'));
    if (j.ok) load();
  });
}

function reject(a: ApprovalItem): void {
  if (!window.confirm(tr('admin.reject.confirm', { name: a.name }))) return;
  post('/api/admin/review/reject', { name: a.name }).then((j) => {
    toast(j.ok ? tr('admin.rejected', { name: a.name }) : tr(j.error || 'common.opFailed'));
    if (j.ok) load();
  });
}

onMounted(load);
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h2 class="text-[13px] font-semibold text-muted">
        {{ tr('admin.pending') }}
        <span class="font-normal">{{ trn('admin.count.items', items.length) }}</span>
      </h2>
      <button
        type="button"
        class="ml-auto rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
        @click="load"
      >
        {{ tr('common.refresh') }}
      </button>
    </div>

    <div class="flex flex-col gap-1.5">
      <p v-if="failed" class="py-2.5 text-center text-xs text-muted">{{ tr(failed) }}</p>
      <p v-else-if="!items.length" class="py-2.5 text-center text-xs text-muted">{{ tr('admin.pendingEmpty') }}</p>
      <div
        v-for="a in items"
        :key="a.name"
        class="flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]"
      >
        <span class="min-w-0 flex-1 truncate font-medium">{{ a.name }}</span>
        <span class="shrink-0 text-[11px] text-muted">{{ tr('admin.created.at', { date: fmtDate(a.created) }) }}</span>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="approve(a)"
        >
          {{ tr('admin.approve.btn') }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
          @click="reject(a)"
        >
          {{ tr('admin.reject.btn') }}
        </button>
      </div>
    </div>
  </section>
</template>
