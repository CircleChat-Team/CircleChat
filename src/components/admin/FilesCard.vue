<script setup lang="ts">
/* ============================================================
 * 全服文件管理（列表 / 搜索 / 下载 / 删除）
 * ============================================================ */
import { ref, inject, onMounted } from 'vue';
import { get, post, url } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { confirm } from '../../core/dialog';
import { fmtSize, fmtDateTime } from '../../core/format';
import type { FileItem } from '../../types';

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

const items = ref<FileItem[]>([]);
const total = ref(0);
const totalSize = ref(0);
const keyword = ref('');
const failed = ref('');

function load(): void {
  let path = '/api/admin/files?limit=200';
  const kw = keyword.value.trim();
  if (kw) path += '&q=' + encodeURIComponent(kw);
  get(path)
    .then((j) => {
      if (!j.ok) {
        failed.value = j.error || 'common.loadFailed';
        items.value = [];
        return;
      }
      failed.value = '';
      items.value = (j.files as FileItem[]) || [];
      total.value = Number(j.total) || 0;
      totalSize.value = Number(j.totalSize) || 0;
    })
    .catch(() => {
      failed.value = 'common.loadFailed';
      items.value = [];
    });
}

function fileUrl(name: string): string {
  return url('/uploads/' + name);
}

/** 悬停提示：存储名 + 原始名 */
function titleOf(f: FileItem): string {
  return f.origin ? f.name + String.fromCharCode(10) + f.origin : f.name;
}

/** 文件类别文案（图片 / 压缩包 / 文档 / 代码 …，由服务端按扩展名判定） */
function kindLabel(f: FileItem): string {
  return tr('file.type.' + f.kind);
}

function remove(f: FileItem): void {
  const label = f.origin || f.name;
  confirm({
    title: tr('admin.files.delTitle'),
    text: f.used
      ? tr('admin.files.delConfirmUsed', { name: label, n: f.used })
      : tr('admin.files.delConfirm', { name: label }),
    okText: tr('admin.files.delBtn')
  }).then((ok) => {
    if (!ok) return;
    post('/api/admin/file/del', { name: f.name }).then((j) => {
      toast(j.ok ? tr('admin.files.deleted', { name: label }) : tr(j.error || 'common.opFailed'));
      if (j.ok) load();
    });
  });
}

onMounted(load);
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <h2 class="text-[13px] font-semibold text-muted">
        {{ tr('admin.files.title') }}
        <span class="font-normal">
          {{ trn('admin.count.files', total) }}{{ total ? tr('admin.files.totalSize', { size: fmtSize(totalSize) }) : '' }}
        </span>
      </h2>

      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="keyword"
          type="text"
          maxlength="64"
          class="h-[30px] w-32 rounded-lg border border-line bg-fill px-2.5 text-xs outline-none transition-colors focus:border-primary"
          :placeholder="tr('admin.files.searchPlaceholder')"
          @keydown.enter.prevent="load"
        >
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="load"
        >
          {{ tr('common.refresh') }}
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <p v-if="failed" class="py-2.5 text-center text-xs text-muted">{{ tr(failed) }}</p>
      <p v-else-if="!items.length" class="py-2.5 text-center text-xs text-muted">{{ tr('admin.files.empty') }}</p>

      <div
        v-for="f in items"
        :key="f.name"
        class="flex items-center gap-2 rounded-xl bg-fill px-2.5 py-1.5 text-xs"
        :class="{ 'opacity-80': !f.used }"
      >
        <span class="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-panel text-muted">
          <img v-if="f.kind === 'image'" :src="fileUrl(f.name)" alt="" loading="lazy" class="h-full w-full object-cover">
          <svg v-else class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
          </svg>
        </span>

        <span class="min-w-0 flex-1 truncate font-medium" :title="titleOf(f)">{{ f.origin || f.name }}</span>
        <span class="shrink-0 rounded bg-primary/12 px-1.5 py-0.5 text-[11px] text-primary">
          {{ kindLabel(f) }}
        </span>
        <span class="shrink-0 text-muted tabular-nums">{{ fmtSize(f.size) }}</span>
        <span class="hidden shrink-0 text-muted tabular-nums sm:inline">{{ fmtDateTime(f.ts) }}</span>
        <span class="shrink-0 text-[11px]" :class="f.used ? 'text-primary' : 'text-muted'">
          {{ f.used ? trn('admin.files.used', f.used) : tr('admin.files.orphan') }}
        </span>

        <a
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs no-underline transition-colors hover:border-primary hover:text-primary"
          :href="fileUrl(f.name)"
          :download="f.origin || f.name"
        >{{ tr('admin.files.download') }}</a>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
          @click="remove(f)"
        >
          {{ tr('admin.files.delBtn') }}
        </button>
      </div>
    </div>
  </section>
</template>
