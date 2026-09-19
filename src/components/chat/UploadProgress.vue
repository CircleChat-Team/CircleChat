<script setup lang="ts">
/* 上传指示器：显示每个文件的上传进度；失败可重试，完成后自动收起 */
import { computed } from 'vue';
import { chatState, retryUpload, dismissUpload } from '../../core/chat';
import type { UploadTask } from '../../core/chat';
import { tr, trn } from '../../core/i18n';
import { fmtSize } from '../../core/format';

const tasks = computed<UploadTask[]>(() => chatState.uploads);
const busy = computed(() => tasks.value.some((t) => t.status === 'uploading' || t.status === 'queued'));

function statusText(t: UploadTask): string {
  if (t.status === 'failed') return t.error || tr('chat.upload.failed');
  if (t.status === 'done') return tr('chat.upload.done');
  if (t.status === 'queued') return tr('chat.upload.queued');
  return t.percent + '%';
}

/** 进度条宽度：失败且不可重试的（超大 / 受限）铺满表示已终止 */
function barWidth(t: UploadTask): string {
  if (t.status === 'done' || (t.status === 'failed' && !t.retryable)) return '100%';
  return t.percent + '%';
}

function barState(t: UploadTask): string {
  if (t.status === 'failed') return 'failed';
  if (t.status === 'done') return 'done';
  return '';
}
</script>

<template>
  <div v-if="tasks.length" class="upload-panel">
    <div v-if="tasks.length > 1 && busy" class="upload-head">
      {{ trn('chat.upload.files', tasks.length) }}
    </div>

    <div v-for="t in tasks" :key="t.id" class="upload-item" :class="t.status">
      <div class="upload-line">
        <svg v-if="t.kind === 'image'" class="upload-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
        </svg>
        <svg v-else class="upload-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16.5 6v11.5a4 4 0 1 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a4 4 0 0 0 8 0V5a5.5 5.5 0 0 0-11 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z" />
        </svg>

        <span class="upload-name" :title="t.name">{{ t.name }}</span>
        <span class="upload-size">{{ fmtSize(t.size) }}</span>
        <span class="upload-status">{{ statusText(t) }}</span>

        <button
          v-if="t.status === 'failed' && t.retryable"
          type="button"
          class="upload-act"
          @click="retryUpload(t.id)"
        >{{ tr('chat.upload.retryBtn') }}</button>
        <button
          v-if="t.status === 'failed' || t.status === 'done'"
          type="button"
          class="upload-act"
          :title="tr('common.close')"
          :aria-label="tr('common.close')"
          @click="dismissUpload(t.id)"
        >×</button>
      </div>

      <div class="upload-bar"><i :class="barState(t)" :style="{ width: barWidth(t) }"></i></div>
    </div>
  </div>
</template>
