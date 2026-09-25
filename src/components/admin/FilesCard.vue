<script setup lang="ts">
// 全服文件管理（列表 / 搜索 / 下载 / 删除）
import { computed, ref, inject, onMounted } from 'vue';
import { get, post, url } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { confirm } from '../../core/dialog';
import { fmtSize, fmtDateTime } from '../../core/format';
import FileViewer from '../chat/FileViewer.vue';
import type { FileViewTarget } from '../../core/fileview';
import type { FileItem } from '../../types';

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

/** 在线查看：图片 / 音频 / 视频 / 文本 / Hex 按内容自动判别（见 FileViewer） */
const fileView = ref<FileViewTarget | null>(null);

function viewFile(f: FileItem): void {
  fileView.value = { url: fileUrl(f.name), name: f.origin || f.name, size: f.size };
}

const items = ref<FileItem[]>([]);
const total = ref(0);
const totalSize = ref(0);
const keyword = ref('');
const failed = ref('');

// 按文件类型筛选（列表已在内存中，前端过滤即可）
const filterKind = ref('');
const kindOptions = computed<string[]>(() => {
  const set = new Set<string>();
  for (const f of items.value) set.add(f.kind);
  return Array.from(set).sort();
});
const view = computed<FileItem[]>(() =>
  filterKind.value ? items.value.filter((f) => f.kind === filterKind.value) : items.value
);

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
      // 列表变了（搜索 / 刷新 / 删除）之后，勾选里不该留下已经不存在的文件
      const alive = items.value.map((f) => f.name);
      selected.value = selected.value.filter((n) => alive.indexOf(n) !== -1);
    })
    .catch(() => {
      failed.value = 'common.loadFailed';
      items.value = [];
    });
}

function fileUrl(name: string): string {
  return url('/uploads/' + name);
}

function titleOf(f: FileItem): string {
  return f.origin ? f.name + String.fromCharCode(10) + f.origin : f.name;
}

/** 文件类别文案（图片 / 压缩包 / 文档 / 代码 …，由服务端按扩展名判定） */
function kindLabel(f: FileItem): string {
  return tr('file.type.' + f.kind);
}

function remove(f: FileItem): void {
  // 用户/群头像受保护：不能在文件管理中删除，提示改用头像移除功能
  if (f.avatar) {
    toast(tr('api.admin.fileIsAvatar'));
    return;
  }
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

const selected = ref<string[]>([]);

const allChecked = computed(() => view.value.length > 0 && selected.value.length === view.value.length);

function isChecked(name: string): boolean {
  return selected.value.indexOf(name) !== -1;
}

function toggleOne(name: string): void {
  const i = selected.value.indexOf(name);
  if (i === -1) selected.value.push(name);
  else selected.value.splice(i, 1);
}

function toggleAll(): void {
  // 受保护的头像文件不参与勾选
  selected.value = allChecked.value ? [] : view.value.filter((f) => !f.avatar).map((f) => f.name);
}

function clearSelection(): void {
  selected.value = [];
}

/** 批量删除：走服务端的批量接口（一次请求 + 一条审计），逐个报告失败项 */
function batchRemove(): void {
  // 过滤掉受保护的头像文件，避免误删
  const names = selected.value.filter((n) => {
    const f = items.value.find((x) => x.name === n);
    return f && !f.avatar;
  });
  if (!names.length) return;
  const usedCount = items.value.filter((f) => names.indexOf(f.name) !== -1 && f.used > 0).length;
  confirm({
    title: tr('admin.files.batchDelTitle'),
    text: usedCount
      ? tr('admin.files.batchDelConfirmUsed', { n: names.length, used: usedCount })
      : tr('admin.files.batchDelConfirm', { n: names.length }),
    okText: tr('admin.files.delBtn')
  }).then((ok) => {
    if (!ok) return;
    post('/api/admin/files/del-batch', { names }).then((j) => {
      if (!j.ok) {
        toast(tr(j.error || 'common.opFailed'));
        return;
      }
      const failed = (j.failed as string[]) || [];
      toast(
        failed.length
          ? tr('admin.files.batchDeletedPartial', { n: Number(j.deleted) || 0, failed: failed.length })
          : tr('admin.files.batchDeleted', { n: Number(j.deleted) || 0 })
      );
      clearSelection();
      load();
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
        <select
          v-model="filterKind"
          class="h-[30px] rounded-lg border border-line bg-fill px-2 text-xs outline-none transition-colors focus:border-primary"
        >
          <option value="">{{ tr('admin.files.filterAll') }}</option>
          <option v-for="k in kindOptions" :key="k" :value="k">{{ tr('file.type.' + k) }}</option>
        </select>
        <!-- 全选当前列表（含搜索 / 筛选后的结果） -->
        <label class="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            class="h-3.5 w-3.5 accent-primary"
            :checked="allChecked"
            :disabled="!view.length"
            @change="toggleAll"
          >
          <span>{{ tr('admin.files.selectAll') }}</span>
        </label>
        <input
          v-model="keyword"
          type="text"
          maxlength="64"
          class="files-search h-[30px] w-32 rounded-lg border border-line bg-fill px-2.5 text-xs outline-none transition-colors focus:border-primary"
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

    <div v-if="selected.length" class="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-fill px-3 py-2 text-xs">
      <span class="font-medium">{{ tr('admin.files.selected', { n: selected.length }) }}</span>
      <div class="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="clearSelection"
        >
          {{ tr('admin.files.clearSelect') }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
          @click="batchRemove"
        >
          {{ tr('admin.files.batchDelBtn') }}
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <p v-if="failed" class="py-2.5 text-center text-xs text-muted">{{ tr(failed) }}</p>
      <p v-else-if="!view.length" class="py-2.5 text-center text-xs text-muted">{{ tr('admin.files.empty') }}</p>

      <div
        v-for="f in view"
        :key="f.name"
        class="file-row flex items-center gap-2 rounded-xl bg-fill px-2.5 py-1.5 text-xs"
        :class="{ 'opacity-80': !f.used }"
      >
        <input
          type="checkbox"
          class="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
          :checked="isChecked(f.name)"
          :disabled="f.avatar"
          :aria-label="f.origin || f.name"
          @change="toggleOne(f.name)"
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
        <span v-if="f.avatar" class="shrink-0 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn">
          {{ tr('admin.files.avatar') }}
        </span>
        <span v-else class="shrink-0 text-[11px]" :class="f.used ? 'text-primary' : 'text-muted'">
          {{ f.used ? trn('admin.files.used', f.used) : tr('admin.files.orphan') }}
        </span>

        <button
          type="button"
          class="file-view shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="viewFile(f)"
        >
          {{ tr('chat.file.view') }}
        </button>
        <a
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs no-underline transition-colors hover:border-primary hover:text-primary"
          :href="fileUrl(f.name)"
          :download="f.origin || f.name"
        >{{ tr('admin.files.download') }}</a>
        <button
          v-if="!f.avatar"
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
          @click="remove(f)"
        >
          {{ tr('admin.files.delBtn') }}
        </button>
        <span v-else class="shrink-0 text-[11px] text-muted">{{ tr('admin.files.avatar') }}</span>
      </div>
    </div>

    <FileViewer v-model="fileView" />
  </section>
</template>
