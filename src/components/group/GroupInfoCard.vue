<script setup lang="ts">
/* ============================================================
 * 群信息（重命名 / 转让群主 / 解散群）
 * ============================================================ */
import { inject } from 'vue';
import { post, del } from '../../core/api';
import { tr } from '../../core/i18n';
import { confirm, prompt } from '../../core/dialog';
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
  prompt({
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
  prompt({
    title: tr('group.transferTitle'),
    text: tr('group.transferPrompt'),
    placeholder: tr('group.transferPlaceholder'),
    okText: tr('group.transferOk'),
    input: { type: 'text', placeholder: tr('group.transferPlaceholder'), maxLength: 20 }
  }).then((name) => {
    if (name == null) return;
    const v = name.trim();
    if (!v) return;
    confirm({
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
  confirm({
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

function setAvatar(): void {
  prompt({
    title: tr('group.avatarTitle'),
    text: tr('group.avatarPrompt'),
    placeholder: tr('group.avatarPlaceholder'),
    okText: tr('group.avatarOk'),
    input: { type: 'text', placeholder: tr('group.avatarPlaceholder'), maxLength: 1024 }
  }).then((avatar) => {
    if (avatar == null) return;
    const v = avatar.trim();
    if (v && !/^https?:\/\//i.test(v)) { toast(tr('group.avatarInvalid')); return; }
    post('/api/groups/avatar', { gid: props.gid, avatar: v }).then((j) => {
      toast(j.ok ? tr('group.avatarSet') : tr(j.error || 'common.opFailed'));
      if (j.ok) emit('refreshed');
    });
  });
}
function setNotice(): void {
  prompt({
    title: tr('group.announce'),
    text: tr('group.announcePrompt'),
    placeholder: tr('group.announcePrompt'),
    okText: tr('group.announceSet'),
    input: { type: 'text', placeholder: tr('group.announcePrompt'), maxLength: 500 }
  }).then((text) => {
    if (text == null) return;
    post('/api/groups/announce', { gid: props.gid, text }).then((j) => {
      toast(j.ok ? tr('group.announceSaved') : tr(j.error || 'common.opFailed'));
      if (j.ok) emit('refreshed');
    });
  });
}
function clearAvatar(): void {
  post('/api/groups/avatar', { gid: props.gid, avatar: '' }).then((j) => {
    toast(j.ok ? tr('group.avatarCleared') : tr(j.error || 'common.opFailed'));
    if (j.ok) emit('refreshed');
  });
}

function copyGid(): void {
  const done = (): void => toast(tr('group.gidCopied'));
  const fallback = (): void => {
    const ta = document.createElement('textarea');
    ta.value = props.gid;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { /* 忽略，用户可手动选中复制 */ }
    document.body.removeChild(ta);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(props.gid).then(done).catch(fallback);
  } else {
    fallback();
  }
}
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">{{ tr('group.info') }}</h2>

    <div class="flex items-center gap-3">
      <img v-if="group.avatar" class="h-14 w-14 shrink-0 rounded-full object-cover" :src="group.avatar" alt="" />
      <span v-else class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-fill text-xl font-semibold text-muted">
        {{ (group.name || '?').slice(0, 1) }}
      </span>
      <div class="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-fill px-2.5 py-2 text-xs">
        <span class="shrink-0 rounded bg-primary/12 px-2 py-0.5 text-[11px] text-primary">{{ group.name }}</span>
        <span class="min-w-0 flex-1 truncate text-muted">
          {{ tr('group.owner', { name: group.owner }) }}{{ isOwner ? tr('common.me') : '' }}
          <span class="ml-2">{{ tr('group.createdAt', { date: fmtDate(group.created) }) }}</span>
        </span>
      </div>
    </div>

    <div class="mt-2 flex items-center gap-2 rounded-lg bg-fill px-2.5 py-2 text-xs">
      <span class="shrink-0 text-muted">{{ tr('group.gid') }}</span>
      <code class="min-w-0 flex-1 truncate select-all font-mono text-[13px] font-semibold">{{ gid }}</code>
      <button
        type="button"
        class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
        @click="copyGid"
      >
        {{ tr('group.copyGid') }}
      </button>
    </div>

    <div class="mt-3 flex flex-wrap gap-2">
      <button
        v-if="isOwner"
        type="button"
        class="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary"
        @click="setAvatar"
      >
        {{ tr('group.setAvatar') }}
      </button>
      <button
        v-if="isOwner && group.avatar"
        type="button"
        class="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs transition-colors hover:border-danger hover:text-danger"
        @click="clearAvatar"
      >
        {{ tr('group.clearAvatar') }}
      </button>
      <button
        v-if="isOwner"
        type="button"
        class="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary"
        @click="setNotice"
      >
        {{ tr('group.announceSet') }}
      </button>
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
