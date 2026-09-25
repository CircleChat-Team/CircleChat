<script setup lang="ts">
/* ============================================================
 * 审计日志
 * 动作标签与下拉选项共用同一份 ACTION_KEYS，避免两处维护。
 * ============================================================ */
import { ref, computed, onMounted } from 'vue';
import { get } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { fmtDateTime } from '../../core/format';
import { ACTION_KEYS, ACTION_GROUPS, formatAuditDetail } from '../../core/auditActions';
import GroupedMultiSelect from '../common/GroupedMultiSelect.vue';
import type { MsGroup } from '../common/GroupedMultiSelect.vue';
import type { LogItem } from '../../types';

/**
 * 每页条数：原来一次拉 200 条全部铺进 DOM，滚动时页面要做大量布局/绘制，
 * 日志一多就明显卡顿。改成服务端分页（接口本来就支持 limit/offset），
 * 渲染量降到 50 行，滚动立刻顺滑，翻页成本也比渲染 200 行低得多。
 */
const PAGE = 50;

const items = ref<LogItem[]>([]);
const total = ref(0);
const actor = ref('');
/** 已选中的动作（空 = 全部）。原来只能选一个，现在可整类 / 跨类多选 */
const actions = ref<string[]>([]);
const failed = ref('');
const page = ref(0);

/** 总页数（至少 1 页，便于显示"第 1 / 1 页"） */
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE)));

/**
 * 拉取一页日志。
 * @param reset 筛选条件变化 / 手动刷新时回到第一页
 */
function load(reset = false): void {
  if (reset) page.value = 0;
  const maxPage = Math.max(0, Math.ceil(total.value / PAGE) - 1);
  if (page.value > maxPage) page.value = maxPage; 
  let path = '/api/admin/logs?limit=' + PAGE + '&offset=' + page.value * PAGE;
  const a = actor.value.trim();
  if (a) path += '&actor=' + encodeURIComponent(a);
  if (actions.value.length) path += '&actions=' + encodeURIComponent(actions.value.join(','));
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

/** 筛选器用的分组数据（组名与动作名都取当前语言） */
const groups = computed<MsGroup[]>(() =>
  ACTION_GROUPS.map((g) => ({
    key: g.key,
    label: tr(g.label),
    options: g.actions.map((a) => ({ value: a, label: actionLabel(a) }))
  }))
);

function onActions(v: string[]): void {
  actions.value = v;
  load(true);
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

/** 详情格式化（实现见 core/auditActions，与群日志共用） */
function formatDetail(d?: string): string {
  return formatAuditDetail(d, tr);
}

function tip(e: LogItem): string {
  if (!e.ip) return '';
  // 原来 "IP: " 是硬编码英文，其它语言下也显示英文前缀
  return tr('admin.log.ip', { ip: e.ip }) + (e.target ? tr('admin.log.target') + e.target : '');
}

onMounted(load);
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h2 class="text-[13px] font-semibold text-muted">
        {{ tr('admin.log.title') }}
        <span class="log-total font-normal">{{ trn('admin.count.items', total) }}</span>
      </h2>

      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="actor"
          type="text"
          maxlength="40"
          class="h-7.5 w-32 rounded-lg border border-line bg-fill px-2.5 text-xs outline-none transition-colors focus:border-primary"
          :placeholder="tr('admin.log.actorPlaceholder')"
          @keydown.enter.prevent="load(true)"
        >
        <!-- 动作筛选：分组多选（可选整类、跨类多选、也可只挑单项） -->
        <GroupedMultiSelect
          :model-value="actions"
          :groups="groups"
          :all-label="tr('admin.log.all')"
          :title-label="tr('admin.log.actionTitle')"
          :select-all-label="tr('admin.log.selectAll')"
          :clear-label="tr('admin.log.clear')"
          :selected-text="(n: number) => tr('admin.log.selectedN', { n })"
          @update:model-value="onActions"
        />
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="load(true)"
        >
          {{ tr('common.refresh') }}
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-1">
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
        <span class="w-26 min-w-0 shrink-0 truncate font-semibold">{{ e.actor || '—' }}</span>
        <span class="log-action shrink-0 whitespace-nowrap rounded bg-primary/12 px-1.5 py-0.5 text-[11px] text-primary">{{ actionLabel(e.action) }}</span>
        <span v-if="e.ip" class="shrink-0 font-mono text-[11px] text-muted">{{ e.ip }}</span>
        <span class="min-w-0 flex-1 truncate">{{ formatDetail(e.detail) }}</span>
      </div>
    </div>

    <div v-if="pages > 1" class="mt-3 flex items-center justify-center gap-2 text-xs">
      <button
        type="button"
        class="rounded-lg border border-line bg-panel px-2.5 py-1 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink"
        :disabled="page <= 0"
        @click="go(-1)"
      >
        {{ tr('admin.log.prev') }}
      </button>
      <span class="text-muted tabular-nums">{{ tr('admin.log.page', { p: page + 1, n: pages }) }}</span>
      <button
        type="button"
        class="rounded-lg border border-line bg-panel px-2.5 py-1 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink"
        :disabled="page >= pages - 1"
        @click="go(1)"
      >
        {{ tr('admin.log.next') }}
      </button>
    </div>
  </section>
</template>
