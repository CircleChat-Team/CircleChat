<script setup lang="ts">
/* ============================================================
 * 视频模态播放器
 * - 消息气泡里只放预览图，点开才在这里播放；
 * - 尺寸取「够看又不顶满屏」：卡片最宽 1080px、视频最高 76vh，
 *   需要更大的话用播放器自带的全屏按钮；
 * - 适配浏览器「小窗（画中画）」：进入小窗后遮罩变透明且不再拦截点击，
 *   页面可继续操作，只留一个小提示条；从小窗返回时自动恢复模态。
 * - Esc / 点背景 / 关闭按钮 均可关闭；关闭时暂停并退出全屏、小窗。
 * ============================================================ */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { chatState, closeVideoView } from '../../core/chat';
import { tr } from '../../core/i18n';

const view = computed(() => chatState.videoView);
const src = computed(() => (view.value ? view.value.src : ''));
const name = computed(() => (view.value ? view.value.name : ''));

const video = ref<HTMLVideoElement | null>(null);
const failed = ref(false);
const pip = ref(false);

function close(): void {
  const v = video.value;
  if (v) {
    try { v.pause(); } catch { /* 忽略 */ }
    // 关掉模态时一并退出全屏 / 小窗，避免留下一个"孤零零"的播放窗口
    try {
      const d = document as Document & {
        pictureInPictureElement?: Element | null;
        exitPictureInPicture?: () => Promise<void>;
        fullscreenElement?: Element | null;
        exitFullscreen?: () => Promise<void>;
      };
      if (d.pictureInPictureElement === v && d.exitPictureInPicture) void d.exitPictureInPicture().catch(() => {});
      if (d.fullscreenElement === v && d.exitFullscreen) void d.exitFullscreen().catch(() => {});
    } catch { /* 忽略 */ }
  }
  pip.value = false;
  closeVideoView();
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  // 处于浏览器全屏 / 小窗时，Esc 先交给浏览器退出，避免"刚退出全屏弹窗也被关掉"
  const d = document as Document & { pictureInPictureElement?: Element | null };
  if (d.fullscreenElement || d.pictureInPictureElement) return;
  close();
}

/** 小窗播放中：遮罩不拦截页面点击，页面照常可用 */
function onEnterPip(): void {
  pip.value = true;
}
function onLeavePip(): void {
  pip.value = false;
}

function exitPip(): void {
  const d = document as Document & { exitPictureInPicture?: () => Promise<void> };
  if (d.exitPictureInPicture) void d.exitPictureInPicture().catch(() => {});
}

/** 模态里的视频：能自动播就自动播（有用户点击手势通常允许），不允许则退回手动点播放 */
function autoplay(): void {
  const v = video.value;
  if (!v) return;
  v.play().catch(() => { /* 自动播放被策略拦下：保留 controls 让用户自己点 */ });
}

watch(src, (s) => {
  failed.value = false;
  pip.value = false;
  if (!s) return;
  void nextTick(autoplay);
});

onMounted(() => {
  document.addEventListener('keydown', onKey);
  void nextTick(autoplay);
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div
    v-if="src"
    class="vv-mask"
    :class="{ 'is-pip': pip }"
    role="dialog"
    aria-modal="true"
    @click.self="close"
  >
    <!-- 小窗播放时只留一条提示，模态本体隐藏但**保持挂载**，否则浏览器会同时关掉小窗 -->
    <div v-if="pip" class="vv-pip-note">
      <span>{{ tr('chat.media.pipNote') }}</span>
      <button type="button" class="vv-btn" @click="exitPip">{{ tr('chat.media.pipBack') }}</button>
    </div>

    <div class="vv-card" @click.stop>
      <div class="vv-head">
        <span class="vv-name" :title="name">{{ name || tr('chat.file.defaultName') }}</span>
        <div class="vv-actions">
          <a class="vv-btn" :href="src" :download="name || ''">{{ tr('chat.media.download') }}</a>
          <button type="button" class="vv-btn vv-close" :aria-label="tr('common.close')" @click="close">×</button>
        </div>
      </div>

      <div class="vv-stage">
        <video
          ref="video"
          class="vv-video"
          :src="src"
          controls
          playsinline
          preload="metadata"
          @error="failed = true"
          @enterpictureinpicture="onEnterPip"
          @leavepictureinpicture="onLeavePip"
        ></video>

        <div v-if="failed" class="vv-fail">
          <span>{{ tr('chat.media.unsupported') }}</span>
          <a class="vv-btn" :href="src" :download="name || ''">{{ tr('chat.media.download') }}</a>
        </div>
      </div>
    </div>
  </div>
</template>
