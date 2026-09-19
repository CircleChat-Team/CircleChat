<script setup lang="ts">
/* ============================================================
 * 视频消息：先显示首帧 + 播放按钮，点击才播放（不自动播放）。
 * 底部显示 文件名 / 格式 · 大小 · 时长。
 * 浏览器无法解码时（例如部分 .mkv / .avi）降级为「下载」提示，
 * 而不是给一个打不开的黑框。
 * ============================================================ */
import { computed, ref } from 'vue';
import { tr } from '../../core/i18n';
import { fmtSize } from '../../core/format';
import { extOf, fmtDur } from '../../core/media';

const props = defineProps<{ src: string; name?: string | null; size?: number | null }>();

const video = ref<HTMLVideoElement | null>(null);
const started = ref(false);
const failed = ref(false);
const duration = ref(0);

const tag = computed(() => {
  const parts: string[] = [];
  const e = extOf(props.name);
  if (e) parts.push(e);
  if (props.size) parts.push(fmtSize(props.size));
  const d = fmtDur(duration.value);
  if (d) parts.push(d);
  return parts.join(' · ');
});

function play(): void {
  const v = video.value;
  if (!v) return;
  started.value = true;
  v.play().catch(() => {
    failed.value = true;
  });
}

function onStage(): void {
  if (!started.value && !failed.value) play();
}

function onMeta(): void {
  const v = video.value;
  if (v && isFinite(v.duration) && v.duration > 0) duration.value = v.duration;
}
</script>

<template>
  <div class="video-msg">
    <div class="video-stage" @click.stop="onStage">
      <video
        ref="video"
        class="video-el"
        :src="src"
        preload="metadata"
        playsinline
        :controls="started && !failed"
        @loadedmetadata="onMeta"
        @play="started = true"
        @error="failed = true"
      ></video>

      <button
        v-if="!started && !failed"
        type="button"
        class="video-play"
        :title="tr('chat.media.play')"
        :aria-label="tr('chat.media.play')"
        @click.stop="play"
      >▶</button>

      <div v-if="failed" class="video-fail">
        <span>{{ tr('chat.media.unsupported') }}</span>
        <a class="video-save" :href="src" :download="name || ''" @click.stop>{{ tr('chat.media.download') }}</a>
      </div>
    </div>

    <div class="media-line">
      <span class="media-name" :title="name || ''">{{ name || tr('chat.file.defaultName') }}</span>
      <span v-if="tag" class="media-tag">{{ tag }}</span>
    </div>
  </div>
</template>
