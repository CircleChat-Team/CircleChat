<script setup lang="ts">
/* ============================================================
 * 小程序 —— 索引源配置（管理员）
 * 官方源内置，部署者可追加第三方源；改完立即刷新合并结果。
 * 单个源失败不影响其他源，失败原因在这里直接显示。
 * ============================================================ */
import { inject, onMounted, ref } from 'vue';
import { get, post } from '../../core/api';
import { tr } from '../../core/i18n';

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

interface Source {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  priority: number;
  official: boolean;
}
interface SourceStatus {
  id: string;
  name: string;
  official: boolean;
  enabled: boolean;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
}

const sources = ref<Source[]>([]);
const status = ref<SourceStatus[]>([]);
const appCount = ref(0);
const installCount = ref(0);
const updatedAt = ref(0);
const failed = ref('');
const busy = ref(false);

function load(): void {
  get('/api/admin/mini')
    .then((j) => {
      if (!j.ok) {
        failed.value = String(j.error || 'common.loadFailed');
        return;
      }
      failed.value = '';
      sources.value = (j.sources as Source[]) || [];
      status.value = (j.status as SourceStatus[]) || [];
      appCount.value = Number(j.appCount || 0);
      installCount.value = Number(j.installCount || 0);
      updatedAt.value = Number(j.updatedAt || 0);
    })
    .catch(() => {
      failed.value = 'common.loadFailed';
    });
}

onMounted(load);

function add(): void {
  sources.value.push({
    id: 'src-' + Date.now().toString(36),
    name: '',
    url: '',
    enabled: true,
    priority: 100,
    official: false
  });
}

function remove(i: number): void {
  sources.value.splice(i, 1);
}

function save(refresh: boolean): void {
  busy.value = true;
  post('/api/admin/mini', { sources: sources.value, refresh })
    .then((j) => {
      busy.value = false;
      if (!j.ok) {
        toast(tr(j.error || 'common.opFailed'));
        return;
      }
      sources.value = (j.sources as Source[]) || sources.value;
      status.value = (j.status as SourceStatus[]) || [];
      appCount.value = Number(j.appCount || 0);
      updatedAt.value = Number(j.updatedAt || 0);
      toast(tr(refresh ? 'admin.mini.refreshed' : 'admin.mini.saved'));
    })
    .catch(() => {
      busy.value = false;
      toast(tr('common.opFailed'));
    });
}

function when(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <div class="mb-3 flex items-center gap-2">
      <h2 class="text-[15px] font-semibold">{{ tr('admin.mini.title') }}</h2>
      <span class="text-xs text-muted">
        {{ tr('admin.mini.summary', { apps: appCount, installs: installCount }) }}
      </span>
      <button
        type="button"
        class="ml-auto rounded-lg border border-line px-3 py-1 text-xs transition-colors hover:text-primary disabled:opacity-50"
        :disabled="busy"
        @click="save(true)"
      >{{ tr('admin.mini.refresh') }}</button>
    </div>

    <p v-if="failed" class="mb-3 text-xs text-danger">{{ tr(failed) }}</p>

    <div class="flex flex-col gap-2">
      <div
        v-for="(s, i) in sources"
        :key="s.id"
        class="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2"
      >
        <input
          v-model="s.name"
          type="text"
          class="w-32 rounded-lg border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-primary"
          :placeholder="tr('admin.mini.namePh')"
          maxlength="60"
        />
        <input
          v-model="s.url"
          type="text"
          class="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-primary"
          :placeholder="tr('admin.mini.urlPh')"
          maxlength="500"
        />
        <input
          v-model.number="s.priority"
          type="number"
          class="w-16 rounded-lg border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-primary"
          :title="tr('admin.mini.priority')"
        />
        <label class="flex items-center gap-1 text-xs text-muted">
          <input v-model="s.enabled" type="checkbox" />
          {{ tr('admin.mini.enabled') }}
        </label>
        <span v-if="s.official" class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
          {{ tr('mini.official') }}
        </span>
        <button
          v-else
          type="button"
          class="rounded-lg border border-line px-2 py-1 text-xs text-danger transition-colors hover:bg-danger/10"
          @click="remove(i)"
        >{{ tr('admin.mini.remove') }}</button>
      </div>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="rounded-lg border border-line px-3 py-1 text-xs transition-colors hover:text-primary"
        @click="add"
      >{{ tr('admin.mini.add') }}</button>
      <button
        type="button"
        class="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        :disabled="busy"
        @click="save(false)"
      >{{ tr('admin.mini.save') }}</button>
      <span class="ml-auto text-[11px] text-muted">{{ tr('admin.mini.updatedAt', { time: when(updatedAt) }) }}</span>
    </div>

    <div v-if="status.length" class="mt-4 border-t border-line pt-3">
      <div class="mb-1.5 text-[13px] font-medium">{{ tr('admin.mini.status') }}</div>
      <div
        v-for="s in status"
        :key="s.id"
        class="flex items-center gap-2 py-0.5 text-[11px] text-muted"
      >
        <span
          class="h-1.5 w-1.5 rounded-full"
          :class="!s.enabled ? 'bg-faint' : s.ok ? 'bg-primary' : 'bg-danger'"
        ></span>
        <span class="shrink-0">{{ s.name }}</span>
        <span class="truncate">{{ s.ok ? tr('admin.mini.okCount', { n: s.count, ms: s.ms }) : (s.error || tr('admin.mini.failed')) }}</span>
      </div>
    </div>
  </section>
</template>
