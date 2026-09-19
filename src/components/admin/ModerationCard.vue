<script setup lang="ts">
/* ============================================================
 * 社区治理卡片：举报审核 + 处罚管理
 * 处罚：警告 / 禁言 / 封禁 / IP 封禁（后三者可设时长 ≤3650 天或永久）
 * ============================================================ */
import { ref, inject, onMounted, reactive } from 'vue';
import { get, post } from '../../core/api';
import { tr } from '../../core/i18n';
import { confirm } from '../../core/dialog';
import { fmtDate } from '../../core/format';
import type { ReportItem, PenaltyItem } from '../../types';

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

const reports = ref<ReportItem[]>([]);
const penalties = ref<PenaltyItem[]>([]);
const failed = ref('');

// 手动新增处罚表单
const form = reactive({ type: 'warning', target: '', days: 1, permanent: false, reason: '' });

// 每条举报的处罚选择
const pick = reactive<Record<number, { type: string; days: number; permanent: boolean; reason: string }>>({});

function pickOf(r: ReportItem) {
  if (!pick[r.id]) pick[r.id] = { type: 'warning', days: 1, permanent: false, reason: '' };
  return pick[r.id];
}

function load(): void {
  Promise.all([
    get('/api/admin/reports?status=' + encodeURIComponent('pending')),
    get('/api/admin/penalties')
  ]).then(([jr, jp]) => {
    if (!(jr && jr.ok) || !(jp && jp.ok)) {
      failed.value = 'common.loadFailed';
      return;
    }
    failed.value = '';
    reports.value = (jr.reports as ReportItem[]) || [];
    penalties.value = (jp.penalties as PenaltyItem[]) || [];
  }).catch(() => {
    failed.value = 'common.loadFailed';
  });
}

/** 忽略举报 */
function dismiss(r: ReportItem): void {
  post('/api/admin/reports/dismiss', { id: r.id }).then((j) => {
    toast(j.ok ? tr('mod.dismissed') : tr(j.error || 'common.opFailed'));
    if (j.ok) load();
  });
}

/** 依举报处罚被举报的消息作者 */
function punish(r: ReportItem): void {
  const p = pickOf(r);
  if (!p.reason.trim()) { toast(tr('mod.reasonRequired')); return; }
  if (!validate(p.type, p.permanent, p.days)) return;
  post('/api/admin/reports/punish', {
    id: r.id, type: p.type, days: p.days, permanent: p.permanent, reason: p.reason.trim()
  }).then((j) => {
    toast(j.ok ? tr('mod.punishDone') : tr(j.error || 'common.opFailed'));
    if (j.ok) load();
  });
}

function validate(type: string, permanent: boolean, days: number): boolean {
  if (type === 'warning') return true;
  if (permanent) return true;
  return Number.isInteger(days) && days >= 1 && days <= 3650;
}

/** 手动新增处罚 */
function addManual(): void {
  const t = form.target.trim();
  if (!t) { toast(tr('mod.targetRequired')); return; }
  const d = Number(form.days);
  if (!validate(form.type, form.permanent, d)) { toast(tr('mod.daysInvalid')); return; }
  post('/api/admin/penalties/add', {
    type: form.type, target: t, days: d, permanent: form.permanent, reason: form.reason.trim()
  }).then((j) => {
    toast(j.ok ? tr('mod.punishDone') : tr(j.error || 'common.opFailed'));
    if (j.ok) { form.target = ''; form.reason = ''; form.type = 'warning'; form.permanent = false; load(); }
  });
}

function revoke(p: PenaltyItem): void {
  confirm({ title: tr('mod.revokeTitle'), text: tr('mod.revokeConfirm'), okText: tr('mod.revoke') }).then((ok) => {
    if (!ok) return;
    post('/api/admin/penalties/revoke', { id: p.id }).then((j) => {
      toast(j.ok ? tr('mod.revoked') : tr(j.error || 'common.opFailed'));
      if (j.ok) load();
    });
  });
}

/** 处罚展示文本 */
function typeText(t: string): string {
  return tr('mod.type.' + t);
}

onMounted(load);
</script>

<template>
  <!-- 待处理举报 -->
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">
      {{ tr('mod.reports.title') }}
      <span class="font-normal">{{ reports.length }}</span>
    </h2>

    <div class="flex flex-col gap-2">
      <p v-if="failed" class="py-2.5 text-center text-xs text-muted">{{ tr(failed) }}</p>
      <p v-else-if="!reports.length" class="py-2.5 text-center text-xs text-muted">{{ tr('mod.reports.empty') }}</p>

      <div v-for="r in reports" :key="r.id" class="rounded-xl bg-fill px-3 py-2.5 text-[13px]">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span class="font-medium text-ink">{{ tr('mod.reported') }}{{ r.msg_from }}</span>
          <span v-if="r.reported_ip">{{ tr('mod.ip') }}{{ r.reported_ip }}</span>
          <span>{{ tr('mod.reason') }}{{ r.reason || '-' }}</span>
          <span class="ml-auto">{{ tr('mod.reporter') }}{{ r.reporter }} · {{ fmtDate(r.created) }}</span>
        </div>
        <div class="mt-1.5 break-words rounded-lg bg-panel px-2.5 py-1.5 text-xs text-muted">
          <span v-if="r.msg_type === 'image'">{{ tr('mod.msgImage') }}</span>
          <span v-else-if="r.msg_type === 'file'">{{ tr('mod.msgFile') }}</span>
          {{ r.msg_snippet || '-' }}
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-2">
          <select
            v-model="pickOf(r).type"
            class="h-7 rounded-lg border border-line bg-panel px-1 text-xs outline-none focus:border-primary"
          >
            <option value="warning">{{ tr('mod.type.warning') }}</option>
            <option value="mute">{{ tr('mod.type.mute') }}</option>
            <option value="ban">{{ tr('mod.type.ban') }}</option>
            <option value="ipban">{{ tr('mod.type.ipban') }}</option>
          </select>
          <template v-if="pickOf(r).type !== 'warning'">
            <label class="flex items-center gap-1 text-xs text-muted">
              <input v-model="pickOf(r).permanent" type="checkbox">
              {{ tr('mod.permanent') }}
            </label>
            <input
              v-if="!pickOf(r).permanent"
              v-model="pickOf(r).days"
              type="number"
              min="1"
              max="3650"
              class="h-7 w-16 rounded-lg border border-line bg-panel px-1 text-xs outline-none focus:border-primary"
            >
            <span v-if="!pickOf(r).permanent" class="text-xs text-muted">{{ tr('mod.days') }}</span>
          </template>
          <input
            v-model="pickOf(r).reason"
            type="text"
            maxlength="200"
            class="h-7 min-w-40 flex-1 rounded-lg border border-line bg-panel px-2 text-xs outline-none focus:border-primary"
            :placeholder="tr('mod.reasonPlaceholder')"
          >
          <button
            type="button"
            class="h-7 shrink-0 rounded-lg bg-primary px-2.5 text-xs text-white transition-colors hover:bg-primary-dark"
            @click="punish(r)"
          >{{ tr('mod.punish') }}</button>
          <button
            type="button"
            class="h-7 shrink-0 rounded-lg border border-line bg-panel px-2.5 text-xs transition-colors hover:border-line hover:text-muted"
            @click="dismiss(r)"
          >{{ tr('mod.dismiss') }}</button>
        </div>
      </div>
    </div>
  </section>

  <!-- 手动处罚 -->
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">{{ tr('mod.add.title') }}</h2>
    <div class="flex flex-wrap items-center gap-2">
      <select
        v-model="form.type"
        class="h-8 rounded-lg border border-line bg-fill px-1.5 text-[13px] outline-none focus:border-primary"
      >
        <option value="warning">{{ tr('mod.type.warning') }}</option>
        <option value="mute">{{ tr('mod.type.mute') }}</option>
        <option value="ban">{{ tr('mod.type.ban') }}</option>
        <option value="ipban">{{ tr('mod.type.ipban') }}</option>
      </select>
      <input
        v-model="form.target"
        type="text"
        maxlength="64"
        class="h-8 min-w-0 flex-1 rounded-lg border border-line bg-fill px-2.5 text-[13px] outline-none focus:border-primary"
        :placeholder="form.type === 'ipban' ? tr('mod.ipTarget') : tr('mod.userTarget')"
      >
      <template v-if="form.type !== 'warning'">
        <label class="flex items-center gap-1 text-xs text-muted">
          <input v-model="form.permanent" type="checkbox"> {{ tr('mod.permanent') }}
        </label>
        <input
          v-if="!form.permanent"
          v-model="form.days"
          type="number"
          min="1"
          max="3650"
          class="h-8 w-18 rounded-lg border border-line bg-fill px-1.5 text-[13px] outline-none focus:border-primary"
        >
        <span v-if="!form.permanent" class="text-xs text-muted">{{ tr('mod.days') }}</span>
      </template>
      <input
        v-model="form.reason"
        type="text"
        maxlength="200"
        class="h-8 min-w-40 flex-1 rounded-lg border border-line bg-fill px-2.5 text-[13px] outline-none focus:border-primary"
        :placeholder="tr('mod.reasonPlaceholder')"
      >
      <button
        type="button"
        class="h-8 shrink-0 rounded-lg bg-primary px-3.5 text-[13px] text-white transition-colors hover:bg-primary-dark"
        @click="addManual"
      >{{ tr('mod.add.submit') }}</button>
    </div>
  </section>

  <!-- 处罚记录 -->
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">{{ tr('mod.penalties.title') }}</h2>
    <div class="flex flex-col gap-1.5">
      <p v-if="!penalties.length" class="py-2.5 text-center text-xs text-muted">{{ tr('mod.penalties.empty') }}</p>
      <div
        v-for="p in penalties"
        :key="p.id"
        class="flex flex-wrap items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]"
      >
        <span class="shrink-0 rounded px-1.5 py-0.5 text-[11px]" :class="p.active ? 'bg-primary/12 text-primary' : 'bg-fill text-muted'">
          {{ typeText(p.type) }}
        </span>
        <span class="min-w-0 flex-1 truncate font-medium">{{ p.target }}</span>
        <span v-if="p.reason" class="shrink-0 truncate text-xs text-muted">{{ p.reason }}</span>
        <span v-if="p.permanent" class="shrink-0 text-[11px] text-danger">{{ tr('mod.permanent') }}</span>
        <span v-else-if="p.expires" class="shrink-0 text-xs text-muted">{{ tr('mod.until', { date: fmtDate(p.expires) }) }}</span>
        <span v-if="!p.active" class="shrink-0 text-[11px] text-muted">{{ tr('mod.inactive') }}</span>
        <button
          v-if="p.active"
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
          @click="revoke(p)"
        >{{ tr('mod.revoke') }}</button>
      </div>
    </div>
  </section>
</template>