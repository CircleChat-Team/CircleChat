<script setup lang="ts">
/* ============================================================
 * 审计日志
 * 动作标签与下拉选项共用同一份 ACTION_KEYS，避免两处维护。
 * ============================================================ */
import { ref, computed, inject, onMounted } from 'vue';
import { get, post } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { fmtDateTime } from '../../core/format';
import { prompt } from '../../core/dialog';
import { ACTION_KEYS, ACTION_GROUPS, formatAuditDetail } from '../../core/auditActions';
import GroupedMultiSelect from '../common/GroupedMultiSelect.vue';
import type { MsGroup } from '../common/GroupedMultiSelect.vue';
import type { LogItem } from '../../types';

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

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

/* ============================================================
 * 导出：按当前筛选条件取全量，在本地生成 txt / csv / json。
 * 动作名与详情用当前语言渲染（服务端存的是 i18n 键），导出文件才可读。
 * ============================================================ */
type ExportFormat = 'txt' | 'csv' | 'json';
const EXPORT_FORMATS: ExportFormat[] = ['txt', 'csv', 'json'];

/** CSV 单元格转义：含逗号/引号/换行时整体加引号，内部引号翻倍 */
function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** 文件名时间戳：20261030-153000 */
function stamp(): string {
  const d = new Date();
  const p = (n: number): string => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportLogs(format: ExportFormat): void {
  let path = '/api/admin/logs/export?';
  const a = actor.value.trim();
  if (a) path += '&actor=' + encodeURIComponent(a);
  if (actions.value.length) path += '&actions=' + encodeURIComponent(actions.value.join(','));
  get(path)
    .then((j) => {
      if (!j.ok) {
        toast(tr(j.error || 'common.opFailed'));
        return;
      }
      const rows = (j.logs as LogItem[]) || [];
      if (!rows.length) {
        toast(tr('admin.log.exportEmpty'));
        return;
      }
      const data = rows.map((e) => ({
        ts: Number(e.ts) || 0,
        time: fmtDateTime(e.ts),
        actor: e.actor || '',
        action: actionLabel(e.action),
        actionCode: e.action,
        target: e.target || '',
        detail: formatDetail(e.detail),
        ip: e.ip || ''
      }));
      const base = 'audit-logs-' + stamp();
      if (format === 'json') {
        download(
          base + '.json',
          JSON.stringify({ exportedAt: fmtDateTime(Date.now()), total: data.length, logs: data }, null, 2),
          'application/json'
        );
        return;
      }
      if (format === 'csv') {
        const head = ['time', 'actor', 'action', 'target', 'detail', 'ip'].join(',');
        const body = data
          .map((r) => [r.time, r.actor, r.action, r.target, r.detail, r.ip].map(csvCell).join(','))
          .join('\r\n');
        // 前置 BOM：Excel 才能正确识别 UTF-8（中文不乱码）
        download(base + '.csv', '\uFEFF' + head + '\r\n' + body + '\r\n', 'text/csv');
        return;
      }
      const lines = [
        tr('admin.log.title') + ' · ' + tr('admin.log.exportedAt', { time: fmtDateTime(Date.now()) }) +
          ' · ' + trn('admin.count.items', data.length),
        ''
      ];
      for (const r of data) {
        lines.push([r.time, r.actor, r.action, r.target, r.detail, r.ip].filter((x) => !!x).join(' | '));
      }
      download(base + '.txt', lines.join('\r\n') + '\r\n', 'text/plain');
    })
    .catch(() => toast(tr('common.opFailed')));
}

/** 清空全部日志：必须逐字输入确认文字，确定按钮才会亮起 */
async function clearLogs(): Promise<void> {
  const phrase = tr('admin.log.clearPhrase');
  const v = await prompt({
    title: tr('admin.log.clearTitle'),
    text: tr('admin.log.clearText', { phrase }),
    okText: tr('admin.log.clearConfirm'),
    cancelText: tr('common.cancel'),
    danger: true,
    input: { placeholder: phrase, maxLength: 32, mustEqual: phrase }
  });
  if (v !== phrase) return;
  post('/api/admin/logs/clear', {}).then((j) => {
    if (!j.ok) {
      toast(tr(j.error || 'common.opFailed'));
      return;
    }
    toast(tr('admin.log.cleared', { n: Number(j.removed) || 0 }));
    load(true);
  }).catch(() => toast(tr('common.opFailed')));
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

      <div class="ml-auto flex flex-wrap items-center justify-end gap-1.5">
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
        <!-- 导出：按当前筛选条件全量导出 txt / csv / json -->
        <div class="flex shrink-0 items-center overflow-hidden rounded-lg border border-line bg-panel">
          <span class="px-2 text-[11px] text-muted">{{ tr('admin.log.export') }}</span>
          <button
            v-for="fmt in EXPORT_FORMATS"
            :key="fmt"
            type="button"
            class="border-l border-line px-2 py-1 text-[11px] font-medium uppercase transition-colors hover:bg-fill hover:text-primary"
            @click="exportLogs(fmt)"
          >{{ fmt }}</button>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs text-danger transition-colors hover:border-danger hover:bg-danger/10"
          @click="clearLogs"
        >
          {{ tr('admin.log.clearBtn') }}
        </button>
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
