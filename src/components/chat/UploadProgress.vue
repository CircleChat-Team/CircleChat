<script setup lang="ts">
/* 上传指示器：显示每个文件的上传进度；失败可重试，完成后自动收起 */
import { computed } from 'vue';
import { chatState, retryUpload, retryAllFailed, dismissUpload, cancelUpload } from '../../core/chat';
import type { UploadTask } from '../../core/chat';
import { tr, trn } from '../../core/i18n';
import { fmtSize } from '../../core/format';

const tasks = computed<UploadTask[]>(() => chatState.uploads);
const busy = computed(() => tasks.value.some((t) => t.status === 'uploading' || t.status === 'queued'));
/** 有可重试的失败任务时，给出「全部重试」入口 */
const hasRetryable = computed(() => tasks.value.some((t) => t.status === 'failed' && t.retryable));

/** 总进度：按字节加权（小文件传完不会被大文件拖成"没进展"的错觉） */
const overallPct = computed(() => {
  const active = tasks.value.filter((t) => t.status !== 'failed');
  const total = active.reduce((a, t) => a + t.size, 0);
  if (!total) return 0;
  const loaded = active.reduce((a, t) => a + Math.min(t.loaded, t.size), 0);
  return Math.min(100, Math.round((loaded / total) * 100));
});

function statusText(t: UploadTask): string {
  if (t.status === 'failed') return t.error || tr('chat.upload.failed');
  if (t.status === 'done') return tr('chat.upload.done');
  if (t.status === 'queued') return tr('chat.upload.queued');
  // 上传中：百分比 +（分片上传时）已传片数 + 实时速度 + 预计剩余时间
  const parts = [t.percent + '%'];
  if (t.chunks && t.chunks > 1) {
    parts.push(tr('chat.upload.parts', { done: t.chunkDone || 0, total: t.chunks }));
  }
  if (t.speed > 0) parts.push(fmtSize(t.speed) + '/s');
  const eta = etaText(t);
  if (eta) parts.push(eta);
  return parts.join(' · ');
}

/** 预计剩余时间：按当前速度外推；不足 1 秒或未测得速度时不显示 */
function etaText(t: UploadTask): string {
  if (t.speed <= 0) return '';
  const remain = (t.size - t.loaded) / t.speed;
  if (!Number.isFinite(remain) || remain < 1) return '';
  const sec = Math.round(remain);
  const human = sec < 60
    ? tr('chat.upload.unitSec', { n: sec })
    : tr('chat.upload.unitMin', { n: Math.floor(sec / 60), s: sec % 60 });
  return tr('chat.upload.remaining', { time: human });
}

/** 体积显示：传输中/已完成显示「已上传 / 总量」，其余只显示总量 */
function sizeText(t: UploadTask): string {
  if (t.status === 'uploading' || t.status === 'done') return fmtSize(t.loaded) + ' / ' + fmtSize(t.size);
  return fmtSize(t.size);
}

function canCancel(t: UploadTask): boolean {
  return t.status === 'queued' || t.status === 'uploading';
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

/** 是否渲染 IDM 式分段进度条：分片上传且已拿到每片进度 */
function isChunked(t: UploadTask): boolean {
  return !!(t.chunks && t.chunks > 1 && t.chunkProgress && t.chunkProgress.length === t.chunks);
}
</script>

<template>
  <div v-if="tasks.length" class="upload-panel">
    <div v-if="tasks.length > 1" class="upload-head">
      <span class="upload-head-text">
        {{ trn('chat.upload.summary', tasks.length) }}
        <template v-if="busy"> · {{ tr('chat.upload.overall', { pct: overallPct }) }}</template>
      </span>
      <button v-if="hasRetryable" type="button" class="upload-act" @click="retryAllFailed">
        {{ tr('chat.upload.retryAll') }}
      </button>
    </div>

    <div v-for="t in tasks" :key="t.id" class="upload-item" :class="t.status">
      <div class="upload-line">
        <img v-if="t.thumbUrl" class="upload-thumb" :src="t.thumbUrl" alt="" />
        <svg v-else-if="t.kind === 'image'" class="upload-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
        </svg>
        <svg v-else class="upload-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16.5 6v11.5a4 4 0 1 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a4 4 0 0 0 8 0V5a5.5 5.5 0 0 0-11 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z" />
        </svg>

        <span class="upload-name" :title="t.name">{{ t.name }}</span>
        <span class="upload-size">{{ sizeText(t) }}</span>
        <span class="upload-status">{{ statusText(t) }}</span>

        <button
          v-if="canCancel(t)"
          type="button"
          class="upload-act"
          :title="tr('chat.upload.cancel')"
          :aria-label="tr('chat.upload.cancel')"
          @click="cancelUpload(t.id)"
        >{{ tr('chat.upload.cancel') }}</button>
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

      <!-- IDM 式分段进度条：分片上传时每片一格，实时展示各片传输进度 -->
      <div v-if="isChunked(t)" class="upload-bar segs" :class="barState(t)">
        <span
          v-for="(p, i) in t.chunkProgress"
          :key="i"
          class="seg"
          :class="{ done: p >= 100, active: p > 0 && p < 100 }"
          :title="tr('chat.upload.partPct', { n: i + 1, p: p })"
        ><span class="seg-fill" :style="{ width: p + '%' }"></span></span>
      </div>
      <div v-else class="upload-bar"><i :class="barState(t)" :style="{ width: barWidth(t) }"></i></div>
    </div>
  </div>
</template>
