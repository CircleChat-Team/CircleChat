<script setup lang="ts">
/* ============================================================
 * 社区治理卡片：举报审核 + 处罚管理 + 申诉处理
 * 处罚：警告 / 禁言 / 封禁 / IP 封禁（后三者可设时长 ≤3650 天或永久）
 * 申诉：被处罚的人提交；**通过会自动撤销关联的那条处罚**，驳回要写备注（备注会通知到本人）
 * ============================================================ */
import { computed, inject, onMounted, reactive, ref } from 'vue';
import { get, post } from '../../core/api';
import { tr } from '../../core/i18n';
import { confirm } from '../../core/dialog';
import { fmtDate } from '../../core/format';
import { appealStatusKey } from '../../core/appeal';
import type { AppealItem, ReportItem, PenaltyItem } from '../../types';

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

const reports = ref<ReportItem[]>([]);
const penalties = ref<PenaltyItem[]>([]);
const failed = ref('');

// 申诉：默认只看待处理，可切到全部
const appeals = ref<AppealItem[]>([]);
const appealFilter = ref<'pending' | 'all'>('pending');
/** 每条申诉的处理备注（会随站内通知发给本人） */
const appealNote = reactive<Record<number, string>>({});

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
    loadAppeals();
  }).catch(() => {
    failed.value = 'common.loadFailed';
  });
}

/** 拉申诉列表（一次拿全量，待处理/全部在本地切） */
function loadAppeals(): void {
  get('/api/admin/appeals?status=').then((j) => {
    appeals.value = (j && j.ok ? (j.appeals as AppealItem[]) : []) || [];
  }).catch(() => {
    appeals.value = [];
  });
}

/** 当前展示哪些申诉 */
const visibleAppeals = computed(() =>
  appealFilter.value === 'pending' ? appeals.value.filter((a) => a.status === 'pending') : appeals.value
);
const pendingAppealCount = computed(() => appeals.value.filter((a) => a.status === 'pending').length);

/**
 * 处理申诉。
 * 通过：服务端会顺手撤销关联处罚，本人立刻恢复（禁言的能发言、封禁的能登录）。
 * 驳回：备注会随站内通知一起发给本人，所以要求必填 —— 不写理由的驳回等于没解释。
 */
function handleAppeal(a: AppealItem, action: 'approve' | 'reject'): void {
  const note = String(appealNote[a.id] || '').trim();
  if (action === 'reject' && !note) { toast(tr('mod.appeal.noteRequired')); return; }
  const run = (): void => {
    post('/api/admin/appeals/handle', { id: a.id, action, note }).then((j) => {
      toast(j.ok ? tr(action === 'approve' ? 'mod.appeal.approved' : 'mod.appeal.rejected') : tr(j.error || 'common.opFailed'));
      if (j.ok) {
        appealNote[a.id] = '';
        load();
      }
    });
  };
  if (action === 'approve') {
    confirm({
      title: tr('mod.appeal.approveTitle'),
      text: tr('mod.appeal.approveConfirm', { user: a.user, type: typeText(String(a.penalty_type || a.type || '')) }),
      okText: tr('mod.appeal.approve')
    }).then((ok) => { if (ok) run(); });
    return;
  }
  run();
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

  <!-- 申诉 -->
  <section class="rounded-card border border-line bg-panel p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h2 class="text-[13px] font-semibold text-muted">
        {{ tr('mod.appeals.title') }}
        <span class="font-normal">{{ pendingAppealCount }}</span>
      </h2>
      <div class="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          class="appeal-tab rounded-lg border px-2.5 py-1 text-xs transition-colors"
          :class="appealFilter === 'pending' ? 'border-primary text-primary' : 'border-line hover:border-primary hover:text-primary'"
          @click="appealFilter = 'pending'"
        >{{ tr('mod.appeals.pending') }}</button>
        <button
          type="button"
          class="appeal-tab rounded-lg border px-2.5 py-1 text-xs transition-colors"
          :class="appealFilter === 'all' ? 'border-primary text-primary' : 'border-line hover:border-primary hover:text-primary'"
          @click="appealFilter = 'all'"
        >{{ tr('mod.appeals.all') }}</button>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <p v-if="!visibleAppeals.length" class="py-2.5 text-center text-xs text-muted">
        {{ tr(appealFilter === 'pending' ? 'mod.appeals.empty' : 'mod.appeals.emptyAll') }}
      </p>

      <div v-for="a in visibleAppeals" :key="a.id" class="appeal-row rounded-xl bg-fill px-3 py-2.5 text-[13px]">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span class="font-medium text-ink">{{ a.user }}</span>
          <span v-if="a.penalty_type" class="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[11px]">{{ typeText(a.penalty_type) }}</span>
          <span v-if="a.status !== 'pending'" class="shrink-0">{{ tr(appealStatusKey(a.status)) }}</span>
          <span class="ml-auto">{{ fmtDate(a.created) }}</span>
        </div>

        <p class="mt-1.5 break-words rounded-lg bg-panel px-2.5 py-1.5 text-xs">{{ a.reason || '-' }}</p>
        <p class="mt-1 text-[11px] leading-relaxed text-muted">
          {{ tr('mod.appeal.penaltyInfo', { type: typeText(String(a.penalty_type || a.type || '')), reason: a.penalty_reason || '-', date: fmtDate(a.penalty_created) }) }}
          <span v-if="a.penalty_active" class="text-danger">{{ tr('mod.appeal.stillActive') }}</span>
          <span v-else>{{ tr('mod.appeal.inactive') }}</span>
        </p>

        <div v-if="a.status === 'pending'" class="mt-2 flex flex-wrap items-center gap-2">
          <input
            v-model="appealNote[a.id]"
            type="text"
            maxlength="200"
            class="appeal-note h-7 min-w-40 flex-1 rounded-lg border border-line bg-panel px-2 text-xs outline-none transition-colors focus:border-primary"
            :placeholder="tr('mod.appeal.notePlaceholder')"
          >
          <button
            type="button"
            class="appeal-approve h-7 shrink-0 rounded-lg bg-primary px-2.5 text-xs text-white transition-colors hover:bg-primary-dark"
            @click="handleAppeal(a, 'approve')"
          >{{ tr('mod.appeal.approve') }}</button>
          <button
            type="button"
            class="appeal-reject h-7 shrink-0 rounded-lg border border-line bg-panel px-2.5 text-xs transition-colors hover:border-danger hover:text-danger"
            @click="handleAppeal(a, 'reject')"
          >{{ tr('mod.appeal.reject') }}</button>
        </div>
        <p v-else class="mt-1 text-[11px] text-muted">
          {{ tr('mod.appeal.handledBy', { by: a.handled_by || '-', date: fmtDate(a.handled_at) }) }}
          <span v-if="a.note"> · {{ tr('mod.appeal.note') }} {{ a.note }}</span>
        </p>
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