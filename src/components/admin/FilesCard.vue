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

/** 每页条数：服务端分页，避免上传目录超过一页后剩下的文件永远看不到 */
const PAGE = 100;

const items = ref<FileItem[]>([]);
const total = ref(0);
const totalSize = ref(0);
const keyword = ref('');
const failed = ref('');
const page = ref(0);
/** 请求序号：快速翻页 / 连续搜索时丢弃先发后到的旧响应 */
let reqSeq = 0;

// 按文件类型筛选交给服务端做，这样筛的是全部文件，而不是只筛当前页
const filterKind = ref('');
/** 类型下拉候选（服务端按当前搜索词统计后返回） */
const kindOptions = ref<string[]>([]);

const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE)));
/** 服务端已按类型 / 搜索过滤，页面直接展示当前页 */
const view = computed<FileItem[]>(() => items.value);

function load(reset = false): void {
  if (reset) page.value = 0;
  const maxPage = Math.max(0, Math.ceil(total.value / PAGE) - 1);
  if (page.value > maxPage) page.value = maxPage;
  let path = '/api/admin/files?limit=' + PAGE + '&offset=' + page.value * PAGE;
  const kw = keyword.value.trim();
  if (kw) path += '&q=' + encodeURIComponent(kw);
  if (filterKind.value) path += '&kind=' + encodeURIComponent(filterKind.value);
  const seq = ++reqSeq;
  get(path)
    .then((j) => {
      if (seq !== reqSeq) return; // 已有更新的请求发出，丢弃本次旧响应
      if (!j.ok) {
        failed.value = j.error || 'common.loadFailed';
        items.value = [];
        return;
      }
      failed.value = '';
      items.value = (j.files as FileItem[]) || [];
      total.value = Number(j.total) || 0;
      totalSize.value = Number(j.totalSize) || 0;
      kindOptions.value = (j.kinds as string[]) || [];
      // 删除 / 筛选后当前页可能已越界：回到最后一页再取一次，避免停在空白页
      const maxPage = Math.max(0, Math.ceil(total.value / PAGE) - 1);
      if (page.value > maxPage) {
        page.value = maxPage;
        load();
        return;
      }
      // 列表变了（搜索 / 筛选 / 刷新 / 删除）之后，勾选里不该留下已经不存在的文件
      const alive = items.value.map((f) => f.name);
      selected.value = selected.value.filter((n) => alive.indexOf(n) !== -1);
    })
    .catch(() => {
      if (seq !== reqSeq) return;
      failed.value = 'common.loadFailed';
      items.value = [];
    });
}

function onKindChange(): void {
  load(true);
}

function go(delta: number): void {
  const next = page.value + delta;
  if (next < 0 || next >= pages.value) return;
  page.value = next;
  load();
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

/** 浏览器能直接当缩略图渲染的图片格式；PSD/AI/RAW 等只显示扩展名徽标，避免裂图 */
const THUMB_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif', 'jxl']);

function extOf(f: FileItem): string {
  const base = String(f.origin || f.name || '').toLowerCase().split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1) : '';
}

function canThumb(f: FileItem): boolean {
  return f.kind === 'image' && THUMB_EXTS.has(extOf(f));
}

/** 列表里的类型徽标文字：优先展示真实扩展名；点文件 / 无扩展名做特判 */
function extBadge(f: FileItem): string {
  const base = String(f.origin || f.name || '').toLowerCase().split('/').pop() || '';
  if (!base) return 'FILE';
  if (base === 'dockerfile' || base === 'containerfile') return 'DOCK';
  if (base === 'makefile' || base === 'gnumakefile') return 'MAKE';
  if (base === 'cmakelists.txt') return 'CMAKE';
  if (base.startsWith('.git')) return 'GIT';
  if (base.startsWith('.env')) return 'ENV';
  if (base.startsWith('.eslint')) return 'ESL';
  if (base.startsWith('.prettier')) return 'PRET';
  const i = base.lastIndexOf('.');
  if (i > 0 && i < base.length - 1) return base.slice(i + 1, i + 5).toUpperCase();
  return (base.replace(/^\./, '').slice(0, 4) || 'FILE').toUpperCase();
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
    post('/api/admin/file/del', { name: f.name })
      .then((j) => {
        toast(j.ok ? tr('admin.files.deleted', { name: label }) : tr(j.error || 'common.opFailed'));
        if (j.ok) load();
      })
      .catch(() => toast(tr('common.opFailed')));
  });
}

const selected = ref<string[]>([]);

/** 可勾选条目（头像文件受保护，不参与全选） */
const selectable = computed(() => view.value.filter((f) => !f.avatar));
const allChecked = computed(
  () => selectable.value.length > 0 && selectable.value.every((f) => selected.value.indexOf(f.name) !== -1)
);

function isChecked(name: string): boolean {
  return selected.value.indexOf(name) !== -1;
}

function toggleOne(name: string): void {
  const i = selected.value.indexOf(name);
  if (i === -1) selected.value.push(name);
  else selected.value.splice(i, 1);
}

function toggleAll(): void {
  // 受保护的头像文件不参与勾选；已勾选其它项时按「补齐/移除可选项」处理，避免误清空
  if (allChecked.value) {
    const names = selectable.value.map((f) => f.name);
    selected.value = selected.value.filter((n) => names.indexOf(n) === -1);
  } else {
    const set = new Set(selected.value);
    for (const f of selectable.value) set.add(f.name);
    selected.value = Array.from(set);
  }
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
    post('/api/admin/files/del-batch', { names })
      .then((j) => {
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
      })
      .catch(() => toast(tr('common.opFailed')));
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
          class="h-7.5 rounded-lg border border-line bg-fill px-2 text-xs outline-none transition-colors focus:border-primary"
          @change="onKindChange"
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
          class="files-search h-7.5 w-32 rounded-lg border border-line bg-fill px-2.5 text-xs outline-none transition-colors focus:border-primary"
          :placeholder="tr('admin.files.searchPlaceholder')"
          @keydown.enter.prevent="load(true)"
        >
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="load(true)"
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
        <span class="flex h-8.5 w-8.5 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-panel text-muted">
          <img v-if="canThumb(f)" :src="fileUrl(f.name)" alt="" loading="lazy" class="h-full w-full object-cover">
          <b v-else class="text-[10px] font-semibold leading-none tracking-tight">{{ extBadge(f) }}</b>
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

    <div v-if="pages > 1" class="mt-3 flex items-center justify-center gap-2 text-xs">
      <button
        type="button"
        class="rounded-lg border border-line bg-panel px-2.5 py-1 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink"
        :disabled="page <= 0"
        @click="go(-1)"
      >
        {{ tr('admin.files.prev') }}
      </button>
      <span class="text-muted tabular-nums">{{ tr('admin.files.page', { p: page + 1, n: pages }) }}</span>
      <button
        type="button"
        class="rounded-lg border border-line bg-panel px-2.5 py-1 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink"
        :disabled="page >= pages - 1"
        @click="go(1)"
      >
        {{ tr('admin.files.next') }}
      </button>
    </div>

    <FileViewer v-model="fileView" />
  </section>
</template>
