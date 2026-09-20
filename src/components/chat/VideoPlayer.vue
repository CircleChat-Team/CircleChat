<script setup lang="ts">
/* ============================================================
 * 视频消息（消息列表里只放预览）
 * - 只在气泡内显示**首帧预览图** + 播放按钮 + 时长，不在这里播放：
 *   气泡宽度有限，内嵌播放器又小又难点，容易和消息操作打架。
 * - 点击预览图 → 打开 VideoViewer 模态播放器（尺寸合适，可全屏/小窗）。
 * - 浏览器无法解码时（例如部分 .mkv / .avi）降级为「下载」提示，
 *   而不是给一个打不开的黑框。
 * ============================================================ */
import { computed, ref } from 'vue';
import { tr } from '../../core/i18n';
import { fmtSize } from '../../core/format';
import { extOf, fmtDur } from '../../core/media';
import { openVideoView } from '../../core/chat';

const props = defineProps<{ src: string; name?: string | null; size?: number | null }>();

const video = ref<HTMLVideoElement | null>(null);
const failed = ref(false);
const duration = ref(0);

const tag = computed(() => {
  const parts: string[] = [];
  const e = extOf(props.name);
  if (e) parts.push(e);
  if (props.size) parts.push(fmtSize(props.size));
  return parts.join(' · ');
});

const durText = computed(() => fmtDur(duration.value));

function onMeta(): void {
  const v = video.value;
  if (!v) return;
  if (isFinite(v.duration) && v.duration > 0) duration.value = v.duration;
  // 部分浏览器（尤其 iOS Safari）在 preload=metadata 下只给黑帧，
  // 轻微 seek 一下能强制把首帧渲染出来，作为「预览图」。
  try {
    if (v.currentTime === 0) v.currentTime = Math.min(0.1, (v.duration || 1) - 0.01);
  } catch {
    /* 忽略：个别浏览器此刻还不允许 seek */
  }
}

function open(): void {
  if (failed.value) return;
  openVideoView(props.src, props.name);
}
</script>

<template>
  <div class="video-msg">
    <div
      class="video-stage"
      role="button"
      tabindex="0"
      :aria-label="tr('chat.media.play')"
      :title="tr('chat.media.play')"
      @click.stop="open"
      @keydown.enter.stop.prevent="open"
      @keydown.space.stop.prevent="open"
    >
      <!-- 只是首帧预览：无 controls、静音、不可操作，所有点击都交给舞台处理 -->
      <video
        ref="video"
        class="video-el"
        :src="src"
        preload="metadata"
        muted
        playsinline
        :controls="false"
        @loadedmetadata="onMeta"
        @error="failed = true"
      ></video>

      <template v-if="!failed">
        <span class="video-play" aria-hidden="true">▶</span>
        <span v-if="durText" class="video-dur">{{ durText }}</span>
      </template>

      <div v-if="failed" class="video-fail">
        <span>{{ tr('chat.media.unsupported') }}</span>
        <a class="video-save" :href="src" :download="name || ''" @click.stop>{{ tr('chat.media.download') }}</a>
      </div>

      <!-- 正常预览时右上角的下载图标 -->
      <a
        v-else
        class="media-dl video-dl"
        :href="src"
        :download="name || ''"
        :title="tr('chat.media.download')"
        :aria-label="tr('chat.media.download')"
        @click.stop
      >
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.55l3.6-3.6 1.42 1.42-6 6-6-6 1.42-1.42L11 13.55V3h1zm-7 16h14v2H5v-2z"/></svg>
      </a>
    </div>

    <div class="media-line">
      <span class="media-name" :title="name || ''">{{ name || tr('chat.file.defaultName') }}</span>
      <span v-if="tag" class="media-tag">{{ tag }}</span>
    </div>
  </div>
</template>
