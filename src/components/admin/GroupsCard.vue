<script setup lang="ts">
/* ============================================================
 * 管理面板 · 群聊卡片
 * 列出系统里的全部群（接口 /api/groups/all，管理员专属），
 * 每行给一个「管理」按钮，改名 / 看成员 / 解散都收进弹窗，避免把行挤爆。
 * ============================================================ */
import { ref, computed, onMounted } from 'vue';
import { get } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { fmtDate } from '../../core/format';
import GroupManageDialog from './GroupManageDialog.vue';
import type { GroupItem } from '../../types';

const items = ref<GroupItem[]>([]);
const failed = ref('');
/** 正在管理的群 id（用 id 而不是对象引用，列表刷新后弹窗内容自动跟着更新） */
const manageId = ref('');
const manageItem = computed(() => items.value.find((g) => g.id === manageId.value) || null);

function load(): void {
  get('/api/groups/all')
    .then((j) => {
      if (!j.ok) {
        failed.value = j.error || 'common.loadFailed';
        items.value = [];
        return;
      }
      failed.value = '';
      items.value = (j.groups as GroupItem[]) || [];
    })
    .catch(() => {
      failed.value = 'common.loadFailed';
      items.value = [];
    });
}

onMounted(load);
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">
      {{ tr('admin.groups.title') }}
      <span class="font-normal">{{ trn('admin.count.groups', items.length) }}</span>
    </h2>

    <div class="flex flex-col gap-1.5">
      <p v-if="failed" class="py-2.5 text-center text-xs text-muted">{{ tr(failed) }}</p>
      <p v-else-if="!items.length" class="py-2.5 text-center text-xs text-muted">
        {{ tr('admin.groups.empty') }}
      </p>

      <div
        v-for="g in items"
        :key="g.id"
        class="flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]"
      >
        <span class="min-w-0 flex-1 truncate font-medium">{{ g.name }}</span>
        <span class="shrink-0 text-[11px] text-muted">{{ tr('group.owner', { name: g.owner }) }}</span>
        <span class="shrink-0 text-[11px] text-muted">{{ trn('group.count.members', g.members || 0) }}</span>
        <span v-if="g.muteAll" class="shrink-0 text-[11px] text-warn">{{ tr('group.muteAll') }}</span>
        <span class="shrink-0 text-[11px] text-muted">{{ fmtDate(g.created) }}</span>

        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="manageId = g.id"
        >
          {{ tr('admin.users.manage') }}
        </button>
      </div>
    </div>
  </section>

  <GroupManageDialog
    :group="manageItem"
    @close="manageId = ''"
    @changed="load"
  />
</template>
