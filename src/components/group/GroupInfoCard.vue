<script setup lang="ts">
/* ============================================================
 * 群信息（重命名 / 转让群主 / 解散群）
 * ============================================================ */
import { inject } from 'vue';
import { post, del } from '../../core/api';
import { tr } from '../../core/i18n';
import { fmtDate } from '../../core/format';
import type { GroupItem } from '../../types';

const props = defineProps<{
  gid: string;
  group: GroupItem;
  isOwner?: boolean;
}>();

const emit = defineEmits<{ refreshed: []; deleted: [] }>();

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

function rename(): void {
  const UI = window.UI;
  if (!UI) return;
  UI.prompt({
    title: tr('group.renameTitle'),
    text: tr('group.renamePrompt'),
    placeholder: tr('group.renamePlaceholder'),
    okText: tr('group.renameOk'),
    input: { type: 'text', placeholder: tr('group.renamePlaceholder'), maxLength: 24 }
  }).then((name) => {
    if (name == null) return;
    const v = name.trim();
    if (!v) return;
    post('/api/groups/rename', { gid: props.gid, name: v }).then((j) => {
      toast(j.ok ? tr('group.renamed') : tr(j.error || 'common.opFailed'));
      if (j.ok) emit('refreshed');
    });
  });
}

function transfer(): void {
  const UI = window.UI;
  if (!UI) return;
  UI.prompt({
    title: tr('group.transferTitle'),
    text: tr('group.transferPrompt'),
    placeholder: tr('group.transferPlaceholder'),
    okText: tr('group.transferOk'),
    input: { type: 'text', placeholder: tr('group.transferPlaceholder'), maxLength: 20 }
  }).then((name) => {
    if (name == null) return;
    const v = name.trim();
    if (!v) return;
    UI.confirm({
      title: tr('group.transferTitle'),
      text: tr('group.transferConfirm', { name: v }),
      okText: tr('group.transferOk')
    }).then((ok) => {
      if (!ok) return;
      post('/api/groups/transfer', { gid: props.gid, name: v }).then((j) => {
        toast(j.ok ? tr('group.transferred', { name: v }) : tr(j.error || 'common.opFailed'));
        if (j.ok) emit('refreshed');
      });
    });
  });
}

function remove(): void {
  const UI = window.UI;
  if (!UI) return;
  UI.confirm({
    title: tr('group.delete'),
    text: tr('group.deleteConfirm'),
    okText: tr('group.delete')
  }).then((ok) => {
    if (!ok) return;
    del('/api/groups', { gid: props.gid }).then((j) => {
      toast(j.ok ? tr('group.deleted') : tr(j.error || 'common.opFailed'));
      if (j.ok) emit('deleted');
    });
  });
}
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">{{ tr('group.info') }}</h2>

    <div class="flex items-center gap-2 rounded-lg bg-fill px-2.5 py-2 text-xs">
      <span class="shrink-0 rounded bg-primary/12 px-2 py-0.5 text-[11px] text-primary">{{ group.name }}</span>
      <span class="min-w-0 flex-1 truncate text-muted">
        {{ tr('group.owner', { name: group.owner }) }}{{ isOwner ? tr('common.me') : '' }}
        <span class="ml-2">{{ tr('group.createdAt', { date: fmtDate(group.created) }) }}</span>
      </span>
    </div>

    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary"
        @click="rename"
      >
        {{ tr('group.rename') }}
      </button>
      <button
        type="button"
        class="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary"
        @click="transfer"
      >
        {{ tr('group.transfer') }}
      </button>
      <button
        type="button"
        class="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs transition-colors hover:border-danger hover:text-danger"
        @click="remove"
      >
        {{ tr('group.delete') }}
      </button>
    </div>
  </section>
</template>
