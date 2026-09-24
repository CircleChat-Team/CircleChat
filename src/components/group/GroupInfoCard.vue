<script setup lang="ts">
/* ============================================================
 * 群信息（重命名 / 转让群主 / 解散群）
 * ============================================================ */
import { inject, ref } from 'vue';
import { post, del } from '../../core/api';
import { tr } from '../../core/i18n';
import { uploadAvatar, setMuteAll, setMemberInviteApprove } from '../../core/chat';
import { confirm, prompt } from '../../core/dialog';
import { fmtDate } from '../../core/format';
import type { GroupItem } from '../../types';

const props = defineProps<{
  gid: string;
  group: GroupItem;
  isOwner?: boolean;
  isManager?: boolean;
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

// 头像统一走「上传」：与个人头像一致，服务端也只认本站上传路径
const avatarInput = ref<HTMLInputElement | null>(null);
const avatarBusy = ref(false);

function setAvatar(): void {
  avatarInput.value?.click();
}
function onAvatarPicked(e: Event): void {
  const el = e.target as HTMLInputElement;
  const file = el.files && el.files[0];
  el.value = ''; // 同一个文件也能再次选中
  if (!file) return;
  avatarBusy.value = true;
  uploadAvatar(file).then((url) => {
    if (!url) { avatarBusy.value = false; return; }
    post('/api/groups/avatar', { gid: props.gid, avatar: url }).then((j) => {
      avatarBusy.value = false;
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

function toggleMuteAll(): void {
  const val = !props.group.muteAll;
  setMuteAll(props.gid, val).then((j) => {
    toast(j.ok ? tr(val ? 'group.muteAllOn' : 'group.muteAllOff') : tr(j.error || 'common.opFailed'));
    if (j.ok) emit('refreshed');
  });
}

function toggleInviteApprove(): void {
  const val = !props.group.memberInviteApprove;
  setMemberInviteApprove(props.gid, val).then((j) => {
    toast(j.ok ? tr('common.saved') : tr(j.error || 'common.opFailed'));
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

    <!-- 群头像：上传（与个人头像同一套流程） -->
    <input ref="avatarInput" type="file" accept="image/*" class="hidden" @change="onAvatarPicked">

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

    <!-- 群设置：仅管理者可见 -->
    <div v-if="isManager" class="mt-3 flex flex-col gap-2">
      <button
        type="button"
        class="flex items-center justify-between rounded-lg bg-fill px-2.5 py-2 text-xs transition-colors hover:bg-fill/70"
        @click="toggleMuteAll"
      >
        <span class="text-ink">{{ tr('group.muteAll') }}</span>
        <span class="font-medium" :class="group.muteAll ? 'text-primary' : 'text-muted'">{{ group.muteAll ? 'ON' : 'OFF' }}</span>
      </button>
      <button
        type="button"
        class="flex items-center justify-between rounded-lg bg-fill px-2.5 py-2 text-xs transition-colors hover:bg-fill/70"
        @click="toggleInviteApprove"
      >
        <span class="text-ink">{{ tr('group.memberInviteApprove') }}</span>
        <span class="font-medium" :class="group.memberInviteApprove ? 'text-primary' : 'text-muted'">{{ group.memberInviteApprove ? 'ON' : 'OFF' }}</span>
      </button>
    </div>

    <div class="mt-3 flex flex-wrap gap-2">
      <button
        v-if="isOwner"
        type="button"
        class="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        :disabled="avatarBusy"
        @click="setAvatar"
      >
        {{ avatarBusy ? tr('common.uploading') : tr('group.setAvatar') }}
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
