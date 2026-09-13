<script setup lang="ts">
/* ============================================================
 * 账号管理（新建 + 列表：改密 / 头像 / 删除）
 * ============================================================ */
import { ref, inject, onMounted } from 'vue';
import { get, post } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { confirm, prompt } from '../../core/dialog';
import { fmtDate } from '../../core/format';
import type { UserItem } from '../../types';

const props = defineProps<{ me: string }>();

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

const items = ref<UserItem[]>([]);
const failed = ref('');
const newName = ref('');
const newPass = ref('');
const passEl = ref<HTMLInputElement | null>(null);

function load(): void {
  get('/api/admin/users')
    .then((j) => {
      if (!j.ok) {
        failed.value = j.error || 'common.loadFailed';
        items.value = [];
        return;
      }
      failed.value = '';
      items.value = (j.users as UserItem[]) || [];
    })
    .catch(() => {
      failed.value = 'common.loadFailed';
      items.value = [];
    });
}

function add(): void {
  const name = newName.value.trim();
  if (!name || newPass.value.length < 6) {
    toast(tr('admin.add.validate'));
    return;
  }
  post('/api/admin/user/add', { name, password: newPass.value }).then((j) => {
    if (!j.ok) {
      toast(tr(j.error || 'admin.add.fail'));
      return;
    }
    toast(tr('admin.added', { name }));
    newName.value = '';
    newPass.value = '';
    load();
  });
}

function focusPass(): void {
  passEl.value?.focus();
}

function changePass(u: UserItem): void {
  prompt({
    title: tr('admin.users.resetTitle'),
    text: tr('admin.users.resetPrompt', { name: u.name }),
    okText: tr('admin.users.resetOk'),
    danger: false,
    input: { type: 'password', placeholder: tr('admin.users.newPassPlaceholder'), maxLength: 64 }
  }).then((p) => {
    if (p == null) return;
    if (p.length < 6) {
      toast(tr('reg.short'));
      return;
    }
    post('/api/admin/user/pass', { name: u.name, password: p }).then((j) => {
      toast(j.ok ? tr('admin.users.passReset') : tr(j.error || 'common.opFailed'));
    });
  });
}

function setAvatar(u: UserItem): void {
  prompt({
    title: tr('admin.users.avatarTitle'),
    text: tr('admin.users.avatarPrompt', { name: u.name }),
    placeholder: tr('admin.users.avatarPlaceholder'),
    okText: tr('admin.users.avatarOk'),
    input: { type: 'text', placeholder: tr('admin.users.avatarPlaceholder'), maxLength: 2048 }
  }).then((v) => {
    if (v == null) return;
    post('/api/admin/user/image', { name: u.name, image: v.trim() }).then((j) => {
      toast(j.ok ? tr('admin.users.avatarUpdated') : tr(j.error || 'common.opFailed'));
      if (j.ok) load();
    });
  });
}

function remove(u: UserItem): void {
  confirm({
    title: tr('admin.users.delTitle'),
    text: tr('admin.users.delConfirm', { name: u.name }),
    okText: tr('admin.users.delBtn')
  }).then((ok) => {
    if (!ok) return;
    post('/api/admin/user/del', { name: u.name }).then((j) => {
      toast(j.ok ? tr('admin.users.deleted', { name: u.name }) : tr(j.error || 'common.opFailed'));
      if (j.ok) load();
    });
  });
}

onMounted(load);
</script>

<template>
  <!-- 新建账号 -->
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">{{ tr('admin.add.title') }}</h2>
    <div class="flex items-center gap-2">
      <input
        v-model="newName"
        type="text"
        maxlength="20"
        class="h-[34px] min-w-0 flex-1 rounded-lg border border-line bg-fill px-2.5 text-[13px] outline-none transition-colors focus:border-primary"
        :placeholder="tr('admin.add.namePlaceholder')"
        @keydown.enter.prevent="focusPass"
      >
      <input
        ref="passEl"
        v-model="newPass"
        type="password"
        maxlength="64"
        class="h-[34px] min-w-0 flex-1 rounded-lg border border-line bg-fill px-2.5 text-[13px] outline-none transition-colors focus:border-primary"
        :placeholder="tr('reg.passPlaceholder')"
        @keydown.enter.prevent="add"
      >
      <button
        type="button"
        class="h-[34px] shrink-0 rounded-lg bg-primary px-3.5 text-[13px] text-white transition-colors hover:bg-primary-dark"
        @click="add"
      >
        {{ tr('admin.add.submit') }}
      </button>
    </div>
  </section>

  <!-- 账号列表 -->
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">
      {{ tr('admin.users.title') }}
      <span class="font-normal">{{ trn('admin.count.users', items.length) }}</span>
    </h2>

    <div class="flex flex-col gap-1.5">
      <p v-if="failed" class="py-2.5 text-center text-xs text-muted">{{ tr(failed) }}</p>
      <p v-else-if="!items.length" class="py-2.5 text-center text-xs text-muted">{{ tr('admin.users.empty') }}</p>

      <div
        v-for="u in items"
        :key="u.name"
        class="flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]"
      >
        <img
          v-if="u.image"
          :src="u.image"
          alt=""
          referrerpolicy="no-referrer"
          class="h-6 w-6 shrink-0 rounded-full object-cover"
        >
        <span class="min-w-0 flex-1 truncate font-medium">
          {{ u.name }}{{ u.name === me ? tr('common.me') : '' }}
        </span>
        <span v-if="u.role === 'admin'" class="shrink-0 text-[11px] text-primary">{{ tr('common.admin') }}</span>
        <span class="shrink-0 text-[11px]" :class="u.online ? 'text-primary' : 'text-muted'">
          {{ u.online ? tr('common.online') : tr('common.offline') }}
        </span>
        <span class="shrink-0 text-[11px] text-muted">{{ fmtDate(u.created) }}</span>

        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="changePass(u)"
        >
          {{ tr('admin.users.changePass') }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="setAvatar(u)"
        >
          {{ u.image ? tr('admin.users.avatarChange') : tr('admin.users.avatarSet') }}
        </button>
        <button
          v-if="u.name !== me"
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
          @click="remove(u)"
        >
          {{ tr('admin.users.delBtn') }}
        </button>
      </div>
    </div>
  </section>
</template>
