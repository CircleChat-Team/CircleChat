<script setup lang="ts">
/* ============================================================
 * 群管理页根组件
 * 群主本人或系统管理员可用；管理员可管理任意群。
 * ============================================================ */
import { ref, provide, watchEffect, onMounted } from 'vue';
import { get, post } from './core/api';
import { tr } from './core/i18n';
import ThemeToggle from './components/common/ThemeToggle.vue';
import GroupInfoCard from './components/group/GroupInfoCard.vue';
import JoinRequestsCard from './components/group/JoinRequestsCard.vue';
import MembersCard from './components/group/MembersCard.vue';
import GroupFilesCard from './components/group/GroupFilesCard.vue';
import Dialog from './components/common/Dialog.vue';
import type { GroupItem, GroupDetail, GroupMember, JoinRequest, GroupFile } from './types';

const props = defineProps<{
  me: string;
  isAdmin: boolean;
  online: string[];
}>();

type ToastFn = (msg: string, ms?: number) => void;

const toastMsg = ref('');
let timer: number | undefined;
const toast: ToastFn = (msg, ms) => {
  toastMsg.value = msg;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    toastMsg.value = '';
  }, ms || 2500);
};
provide('toast', toast);

const groups = ref<GroupItem[]>([]);
const gid = ref('');
const detail = ref<GroupDetail | null>(null);
const err = ref('');

watchEffect(() => {
  document.title = tr('group.title');
});

function loadGroups(): Promise<GroupItem[]> {
  // 管理员可管理全服群，普通用户只能管自己所在的群
  return get(props.isAdmin ? '/api/groups/all' : '/api/groups').then((j) => {
    if (!j.ok) {
      err.value = j.error || 'common.loadFailed';
      groups.value = [];
      return [];
    }
    err.value = '';
    groups.value = (j.groups as GroupItem[]) || [];
    return groups.value;
  });
}

function loadDetail(): void {
  if (!gid.value) {
    detail.value = null;
    return;
  }
  get('/api/groups/manage?gid=' + encodeURIComponent(gid.value))
    .then((j) => {
      if (!j.ok) {
        err.value = j.error || 'common.loadFailed';
        detail.value = null;
        return;
      }
      err.value = '';
      detail.value = {
        group: j.group as GroupItem,
        isOwner: !!j.isOwner,
        requests: (j.requests as JoinRequest[]) || [],
        members: (j.members as GroupMember[]) || [],
        files: (j.files as GroupFile[]) || []
      };
    })
    .catch(() => {
      err.value = 'common.loadFailed';
      detail.value = null;
    });
}

/** 刷新当前群（重命名 / 审核 / 移除成员 / 删文件后调用） */
function refresh(): void {
  loadGroups().then(loadDetail);
}

/** 群已解散：清空选择并回到第一个群 */
function onDeleted(): void {
  gid.value = '';
  detail.value = null;
  loadGroups().then((list) => {
    if (list.length) select(list[0].id);
  });
}

/** 记住当前群，刷新后尽量停留在同一群（不参与权限校验） */
function persistGid(id: string): void {
  try {
    const u = new URL(location.href);
    if (id) u.searchParams.set('gid', id);
    else u.searchParams.delete('gid');
    history.replaceState(null, '', u);
  } catch {
    /* 忽略 */
  }
}

function select(id: string): void {
  gid.value = id;
  persistGid(id);
  loadDetail();
}

function onSelect(e: Event): void {
  select((e.target as HTMLSelectElement).value);
}

function back(): void {
  location.href = '/chat.html';
}

function logout(): void {
  post('/api/logout', {}).catch(() => {
    /* 忽略 */
  });
  location.replace('/login.html');
}

onMounted(() => {
  loadGroups().then((list) => {
    const initial = new URLSearchParams(location.search).get('gid') || '';
    const hit = list.some((g) => g.id === initial);
    const target = hit ? initial : list.length ? list[0].id : '';
    if (target) select(target);
  });
});
</script>

<template>
  <div class="min-h-screen bg-bg text-ink">
    <header class="sticky top-0 z-5 flex h-14 items-center gap-2 border-b border-line bg-panel/80 px-4 backdrop-blur-xl">
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-fill hover:text-ink"
          :title="tr('admin.back')"
          :aria-label="tr('admin.back')"
          @click="back"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <span class="shrink-0 text-base font-semibold">{{ tr('group.title') }}</span>

        <select
          class="h-8 min-w-0 flex-1 rounded-lg border border-line bg-fill px-2 text-xs outline-none transition-colors focus:border-primary"
          :title="tr('group.select')"
          :value="gid"
          @change="onSelect"
        >
          <option v-if="!groups.length" value="">{{ tr('group.none') }}</option>
          <option v-for="g in groups" :key="g.id" :value="g.id">
            {{ g.name }}（{{ tr('group.owner', { name: g.owner }) }}）
          </option>
        </select>
      </div>

      <div class="ml-auto flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-fill hover:text-danger"
          :title="tr('common.logout')"
          @click="logout"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
          </svg>
          <span>{{ tr('chat.logoutShort') }}</span>
        </button>
      </div>
    </header>

    <main class="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-5 pb-10">
      <p v-if="err" class="rounded-xl bg-fill px-3 py-2 text-center text-xs text-danger">{{ tr(err) }}</p>

      <template v-if="detail">
        <GroupInfoCard
          :gid="gid"
          :group="detail.group"
          :is-owner="detail.isOwner"
          @refreshed="refresh"
          @deleted="onDeleted"
        />
        <JoinRequestsCard :gid="gid" :requests="detail.requests" @refreshed="refresh" />
        <MembersCard :gid="gid" :members="detail.members" :online="online" @refreshed="refresh" />
        <GroupFilesCard :gid="gid" :files="detail.files" @refreshed="refresh" />
      </template>
      <p v-else-if="!err" class="py-10 text-center text-xs text-muted">{{ tr('common.loadFailed') }}</p>
    </main>

    <div
      v-if="toastMsg"
      class="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink/90 px-4 py-2 text-sm text-panel shadow-lg"
    >
      {{ toastMsg }}
    </div>

    <Dialog />
  </div>
</template>
