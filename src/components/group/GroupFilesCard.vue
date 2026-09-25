<script setup lang="ts">
// 群内图片 / 文件管理
import { inject, ref } from 'vue';
import { post } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { confirm } from '../../core/dialog';
import { fmtSize, fmtDate } from '../../core/format';
import FileViewer from '../chat/FileViewer.vue';
import type { FileViewTarget } from '../../core/fileview';
import type { GroupFile } from '../../types';

const props = defineProps<{
  gid: string;
  files: GroupFile[];
}>();

const emit = defineEmits<{ refreshed: [] }>();

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

/** 在线查看：图片 / 音频 / 视频 / 文本 / Hex 按内容自动判别（见 FileViewer） */
const fileView = ref<FileViewTarget | null>(null);

function viewFile(f: GroupFile): void {
  fileView.value = { url: f.content || '', name: f.name || '', size: f.size };
}

function remove(f: GroupFile): void {
  confirm({
    title: tr('group.fileDeleteTitle'),
    text: tr('group.fileDeleteConfirm'),
    okText: tr('admin.files.delBtn')
  }).then((ok) => {
    if (!ok) return;
    post('/api/groups/file/delete', { gid: props.gid, idx: f.idx }).then((j) => {
      toast(j.ok ? tr('group.fileDeleted') : tr(j.error || 'common.opFailed'));
      if (j.ok) emit('refreshed');
    });
  });
}
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-3 text-[13px] font-semibold text-muted">
      {{ tr('group.files') }}
      <span class="font-normal">{{ trn('admin.count.files', files.length) }}</span>
    </h2>

    <div class="flex max-h-[420px] flex-col gap-1 overflow-y-auto">
      <p v-if="!files.length" class="py-2.5 text-center text-xs text-muted">{{ tr('group.filesEmpty') }}</p>

      <div
        v-for="f in files"
        :key="f.idx"
        class="flex items-center gap-2 rounded-lg bg-fill px-2.5 py-1.5 text-xs"
        :title="f.content"
      >
        <span class="shrink-0 rounded bg-primary/12 px-1.5 py-0.5 text-[11px] text-primary">
          {{ f.type === 'image' ? tr('chat.quote.image') : tr('group.fileTag') }}
        </span>
        <span class="min-w-0 flex-1 truncate">
          {{ f.type === 'image' ? tr('chat.upload.kindImage') : (f.name || tr('chat.upload.kindFile')) }}
          <span v-if="f.size" class="text-muted">（{{ fmtSize(f.size) }}）</span>
          <span class="ml-2 text-muted">{{ fmtDate(f.ts) }}</span>
        </span>
        <button
          v-if="f.content"
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="viewFile(f)"
        >
          {{ tr('chat.file.view') }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
          @click="remove(f)"
        >
          {{ tr('admin.files.delBtn') }}
        </button>
      </div>
    </div>

    <FileViewer v-model="fileView" />
  </section>
</template>
