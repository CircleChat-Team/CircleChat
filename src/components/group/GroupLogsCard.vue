<script setup lang="ts">
/* ============================================================
 * 群内操作日志
 * 数据来自全局审计表，仅取本群的管理类动作（改名 / 公告 / 头像 /
 * 成员移除 / 入群审核 / 群主转让 / 删群文件 / 加群退群等），
 * 不含聊天消息。群主与系统管理员可见。
 * ============================================================ */
import { ref, computed, watch, onMounted } from 'vue';
import { get } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { fmtDateTime } from '../../core/format';
import { ACTION_KEYS, formatAuditDetail } from '../../core/auditActions';
import type { LogItem } from '../../types';

const props = defineProps<{ gid: string }>();

const PAGE = 30;
const items = ref<LogItem[]>([]);
const total = ref(0);
const page = ref(0);
const failed = ref('');

const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE)));

function load(reset = false): void {
  if (!props.gid) return;
  if (reset) page.value = 0;
  const path = '/api/groups/logs?gid=' + encodeURIComponent(props.gid)
    + '&limit=' + PAGE + '&offset=' + page.value * PAGE;
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

function go(delta: number): void {
  const next = page.value + delta;
  if (next < 0 || next >= pages.value) return;
  page.value = next;
  load();
}

function actionLabel(a: string): string {
  const k = ACTION_KEYS[a];
  return k ? tr(k) : a;
}

function formatDetail(d?: string): string {
  return formatAuditDetail(d, tr);
}

watch(() => props.gid, () => load(true));
onMounted(() => load(true));
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <div class="mb-3 flex items-center gap-2">
      <h2 class="text-[13px] font-semibold text-muted">
        {{ tr('group.log.title') }}
        <span class="font-normal">{{ trn('admin.count.items', total) }}</span>
      </h2>
      <button
        type="button"
        class="ml-auto shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
        @click="load(true)"
      >
        {{ tr('common.refresh') }}
      </button>
    </div>

    <div class="flex flex-col gap-1">
      <p v-if="failed" class="py-2.5 text-center text-xs text-muted">{{ tr(failed) }}</p>
      <p v-else-if="!items.length" class="py-2.5 text-center text-xs text-muted">{{ tr('group.log.empty') }}</p>

      <div
        v-for="(e, i) in items"
        :key="e.id ?? i"
        class="flex items-center gap-2.5 rounded-lg bg-fill px-2.5 py-1.5 text-xs"
        :title="e.ip ? tr('admin.log.ip', { ip: e.ip }) : ''"
      >
        <span class="shrink-0 text-muted tabular-nums">{{ fmtDateTime(e.ts) }}</span>
        <span class="w-24 min-w-0 shrink-0 truncate font-semibold">{{ e.actor || '—' }}</span>
        <span class="shrink-0 whitespace-nowrap rounded bg-primary/12 px-1.5 py-0.5 text-[11px] text-primary">{{ actionLabel(e.action) }}</span>
        <span class="min-w-0 flex-1 truncate">{{ formatDetail(e.detail) }}</span>
      </div>
    </div>

    <div v-if="pages > 1" class="mt-3 flex items-center justify-center gap-2 text-xs">
      <button
        type="button"
        class="rounded-lg border border-line bg-panel px-2.5 py-1 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="page <= 0"
        @click="go(-1)"
      >
        {{ tr('admin.log.prev') }}
      </button>
      <span class="text-muted tabular-nums">{{ tr('admin.log.page', { p: page + 1, n: pages }) }}</span>
      <button
        type="button"
        class="rounded-lg border border-line bg-panel px-2.5 py-1 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="page >= pages - 1"
        @click="go(1)"
      >
        {{ tr('admin.log.next') }}
      </button>
    </div>
  </section>
</template>
