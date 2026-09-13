<script setup lang="ts">
/* ============================================================
 * 审计日志
 * 动作标签与下拉选项共用同一份 ACTION_KEYS，避免两处维护。
 * ============================================================ */
import { ref, onMounted } from 'vue';
import { get } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { fmtDateTime } from '../../core/format';
import type { LogItem } from '../../types';

/** 审计动作 → 文案 key */
const ACTION_KEYS: Record<string, string> = {
  'login': 'admin.action.login',
  'login.fail': 'admin.action.loginFail',
  'logout': 'admin.action.logout',
  'msg': 'admin.action.msg',
  'group.msg': 'admin.action.groupMsg',
  'dm.msg': 'admin.action.dmMsg',
  'recall': 'admin.action.recall',
  'group.recall': 'admin.action.groupRecall',
  'dm.recall': 'admin.action.dmRecall',
  'upload': 'admin.action.upload',
  'settings': 'admin.action.settings',
  'register': 'admin.action.register',
  'friend.request': 'admin.action.friendRequest',
  'friend.accept': 'admin.action.friendAccept',
  'admin.review.approve': 'admin.action.approve',
  'admin.review.reject': 'admin.action.reject',
  'admin.user.add': 'admin.action.userAdd',
  'admin.user.del': 'admin.action.userDel',
  'admin.user.pass': 'admin.action.userPass',
  'admin.file.del': 'admin.action.fileDel',
  'group.create': 'admin.action.groupCreate',
  'group.dissolve': 'admin.action.groupDissolve',
  'group.join': 'admin.action.groupJoin',
  'group.leave': 'admin.action.groupLeave',
  'group.rename': 'admin.action.groupRename'
};

const items = ref<LogItem[]>([]);
const total = ref(0);
const actor = ref('');
const action = ref('');
const failed = ref('');

function load(): void {
  let path = '/api/admin/logs?limit=200';
  const a = actor.value.trim();
  if (a) path += '&actor=' + encodeURIComponent(a);
  if (action.value) path += '&action=' + encodeURIComponent(action.value);
  get(path)
    .then((j) => {
      if (!j.ok) {
        failed.value = j.error || 'common.loadFailed';
        items.value = [];
        return;
      }
      failed.value = '';
      items.value = (j.logs as LogItem[]) || [];
      total.value = Number(j.total) || 0;
    })
    .catch(() => {
      failed.value = 'common.loadFailed';
      items.value = [];
    });
}

function actionLabel(a: string): string {
  const k = ACTION_KEYS[a];
  return k ? tr(k) : a;
}

/** 详情：新格式为 JSON {k: i18n 键, v: 变量}；旧版写死的中文原样显示 */
function formatDetail(d?: string): string {
  if (!d) return '';
  try {
    const o = JSON.parse(d) as { k?: string; v?: Record<string, string | number> };
    if (o && typeof o === 'object' && typeof o.k === 'string') return tr(o.k, o.v || {});
  } catch {
    /* 旧版详情，原样显示 */
  }
  return d;
}

function tip(e: LogItem): string {
  if (!e.ip) return '';
  return 'IP: ' + e.ip + (e.target ? tr('admin.log.target') + e.target : '');
}

onMounted(load);
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h2 class="text-[13px] font-semibold text-muted">
        {{ tr('admin.log.title') }}
        <span class="font-normal">
          {{ trn('admin.count.items', total) }}{{ total > items.length ? tr('admin.log.shown', { n: items.length }) : '' }}
        </span>
      </h2>

      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="actor"
          type="text"
          maxlength="40"
          class="h-[30px] w-32 rounded-lg border border-line bg-fill px-2.5 text-xs outline-none transition-colors focus:border-primary"
          :placeholder="tr('admin.log.actorPlaceholder')"
          @keydown.enter.prevent="load"
        >
        <select
          v-model="action"
          class="h-[30px] rounded-lg border border-line bg-fill px-1.5 text-xs outline-none transition-colors focus:border-primary"
          :title="tr('admin.log.actionTitle')"
          @change="load"
        >
          <option value="">{{ tr('admin.log.all') }}</option>
          <option v-for="(k, a) in ACTION_KEYS" :key="a" :value="a">{{ tr(k) }}</option>
        </select>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="load"
        >
          {{ tr('common.refresh') }}
        </button>
      </div>
    </div>

    <div class="flex max-h-[420px] flex-col gap-1 overflow-y-auto">
      <p v-if="failed" class="py-2.5 text-center text-xs text-muted">{{ tr(failed) }}</p>
      <p v-else-if="!items.length" class="py-2.5 text-center text-xs text-muted">{{ tr('admin.log.empty') }}</p>

      <div
        v-for="(e, i) in items"
        :key="e.id ?? i"
        class="flex items-center gap-2.5 rounded-lg bg-fill px-2.5 py-1.5 text-xs"
        :class="{ 'text-danger': e.action === 'login.fail' }"
        :title="tip(e)"
      >
        <span class="shrink-0 text-muted tabular-nums">{{ fmtDateTime(e.ts) }}</span>
        <span class="w-[74px] min-w-0 shrink-0 truncate font-semibold">{{ e.actor || '—' }}</span>
        <span class="shrink-0 rounded bg-primary/12 px-1.5 py-0.5 text-[11px] text-primary">{{ actionLabel(e.action) }}</span>
        <span class="min-w-0 flex-1 truncate">{{ formatDetail(e.detail) }}</span>
      </div>
    </div>
  </section>
</template>
