<script setup lang="ts">
/* ============================================================
 * 账号管理（新建 + 列表：改密 / 头像 / 删除）
 * ============================================================ */
import { ref, computed, inject, onMounted } from 'vue';
import { get, post } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { fmtDate } from '../../core/format';
import { passwordOk } from '../../core/password';
import UserManageDialog from './UserManageDialog.vue';
import type { UserItem } from '../../types';
import { presenceStatusKey } from '../../core/presence';

const props = defineProps<{ me: string }>();

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

/** 在线状态文案 key（网页端 / 客户端 / 两端同时在线） */
function statusKey(u: UserItem): string {
  return presenceStatusKey(!!u.online, false, u.platform);
}

const items = ref<UserItem[]>([]);
const failed = ref('');
const newName = ref('');
const newPass = ref('');
const passEl = ref<HTMLInputElement | null>(null);

/** 正在管理的账号名；用名字而不是对象引用，列表刷新后弹窗内容自动跟着更新 */
const manageName = ref('');
const manageUser = computed(() => items.value.find((u) => u.name === manageName.value) || null);

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
  if (!name || !passwordOk(newPass.value)) {
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

/** 弹窗里改完（改名 / 头像 / 删除）后刷新列表 */
function onManageChanged(): void {
  load();
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
          {{ tr('common.' + statusKey(u)) }}
        </span>
        <span class="shrink-0 text-[11px] text-muted">{{ fmtDate(u.created) }}</span>

        <!-- 操作收进弹窗：功能变多后平铺一排按钮会把行挤爆 -->
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="manageName = u.name"
        >
          {{ tr('admin.users.manage') }}
        </button>
      </div>
    </div>
  </section>

  <UserManageDialog
    :user="manageUser"
    :me="me"
    @close="manageName = ''"
    @changed="onManageChanged"
  />
</template>
