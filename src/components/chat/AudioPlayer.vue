<script setup lang="ts">
/* ============================================================
 * 音频消息：点击才播放（不自动播放）。
 * 展示 文件名 / 格式 · 大小 · 时长；未播放时也绘制静态音谱条，
 * 播放中切换为 Web Audio AnalyserNode 的实时频谱。
 * ============================================================ */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { tr } from '../../core/i18n';
import { fmtSize } from '../../core/format';
import { extOf, fmtDur } from '../../core/media';

const props = defineProps<{ src: string; name?: string; size?: number | null }>();

const audio = ref<HTMLAudioElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const playing = ref(false);
const duration = ref(0);
/** 当前播放位置（秒），用于进度条与时间显示 */
const current = ref(0);
const seekEl = ref<HTMLElement | null>(null);
/** 是否正在拖动进度（拖动期间忽略 timeupdate，避免进度条被播放位置顶回） */
let seeking = false;
let resumeAfterSeek = false;

const BARS = 28;

/** 进度百分比 0-100 */
const pct = computed(() => {
  const d = duration.value;
  return d > 0 ? Math.min(100, Math.max(0, (current.value / d) * 100)) : 0;
});

function onTime(): void {
  const a = audio.value;
  if (!a || isFinite(a.currentTime)) current.value = a.currentTime;
}

/** 把指针位置换算成时间并写入播放器 */
function applySeek(e: PointerEvent): void {
  const el = seekEl.value;
  const a = audio.value;
  if (!el || !a) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const t = ratio * (isFinite(a.duration) && a.duration > 0 ? a.duration : 0);
  a.currentTime = t;
  current.value = t;
}

/** 开始拖拽进度：记住播放状态并暂停（避免拖动时还在播放造成跳变） */
function onSeekStart(e: PointerEvent): void {
  e.preventDefault();
  const a = audio.value;
  if (!a) return;
  seeking = true;
  resumeAfterSeek = !a.paused;
  a.pause();
  applySeek(e);
  window.addEventListener('pointermove', onSeekMove);
  window.addEventListener('pointerup', onSeekEnd);
}
function onSeekMove(e: PointerEvent): void {
  if (seeking) applySeek(e);
}
function onSeekEnd(e: PointerEvent): void {
  if (!seeking) return;
  seeking = false;
  window.removeEventListener('pointermove', onSeekMove);
  window.removeEventListener('pointerup', onSeekEnd);
  applySeek(e);
  const a = audio.value;
  if (!a) return;
  if (resumeAfterSeek) a.play().catch(() => { /* 被策略拦下则保持暂停 */ });
  else current.value = a.currentTime;
}

const tag = computed(() => {
  const parts: string[] = [];
  const e = extOf(props.name);
  if (e) parts.push(e);
  if (props.size) parts.push(fmtSize(props.size));
  const d = fmtDur(duration.value);
  if (d) parts.push(d);
  return parts.join(' · ');
});

// 未播放时的静态波形：以文件名做种子，保证同一文件每次形状一致（不是随机跳动）
const shape = (() => {
  const s = String(props.name || props.src || '');
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  x = x >>> 0 || 1;
  const out: number[] = [];
  for (let i = 0; i < BARS; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out.push(0.24 + (((x >>> 8) % 1000) / 1000) * 0.6);
  }
  return out;
})();

let actx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let raf = 0;
let freq: Uint8Array<ArrayBuffer> | null = null;

function accent(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  return v || '#07c160';
}

function draw(): void {
  const c = canvas.value;
  const g = c ? c.getContext('2d') : null;
  if (!c || !g) return;
  const w = c.width;
  const h = c.height;
  g.clearRect(0, 0, w, h);
  const bw = w / BARS;
  g.fillStyle = accent();
  const live = playing.value && analyser !== null && freq !== null;
  if (live && analyser && freq) analyser.getByteFrequencyData(freq);
  for (let i = 0; i < BARS; i++) {
    const v = live && freq
      ? freq[Math.floor(((i + 1) * freq.length) / (BARS + 1))] / 255
      : shape[i];
    const bh = Math.max(3, v * (h - 4));
    g.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh);
  }
}

function loop(): void {
  draw();
  raf = requestAnimationFrame(loop);
}

function ensureGraph(): void {
  if (actx || !audio.value) return;
  const AC = window.AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    actx = new AC();
    const source = actx.createMediaElementSource(audio.value);
    analyser = actx.createAnalyser();
    analyser.fftSize = 64;
    freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    source.connect(analyser);
    analyser.connect(actx.destination);
  } catch {
    actx = null;
    analyser = null;
  }
}

function toggle(): void {
  const a = audio.value;
  if (!a) return;
  if (a.paused) {
    ensureGraph();
    if (actx && actx.state === 'suspended') void actx.resume();
    void a.play();
  } else {
    a.pause();
  }
}

function onPlay(): void {
  playing.value = true;
  if (!raf) loop();
}
function onStop(): void {
  playing.value = false;
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  draw();
}
function onLoaded(): void {
  const a = audio.value;
  if (a && isFinite(a.duration) && a.duration > 0) duration.value = a.duration;
}

onMounted(draw); // 关键：首帧就画出音谱条，别等播放才出现
onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
  if (actx) { try { void actx.close(); } catch { /* 忽略 */ } }
});
</script>

<template>
  <div class="audio-msg bubble" :class="{ playing }" @click.stop="toggle">
    <button
      type="button"
      class="audio-btn"
      :title="playing ? tr('chat.media.pause') : tr('chat.media.play')"
      :aria-label="playing ? tr('chat.media.pause') : tr('chat.media.play')"
      @click.stop="toggle"
    >{{ playing ? '❚❚' : '▶' }}</button>

    <div class="audio-body">
      <div class="media-line">
        <span class="media-name" :title="name || ''">{{ name || tr('chat.file.defaultName') }}</span>
        <span v-if="tag" class="media-tag">{{ tag }}</span>
      </div>
      <canvas ref="canvas" class="audio-bars" width="240" height="30"></canvas>
      <!-- 可拖拽/点击的播放进度条 -->
      <div ref="seekEl" class="audio-progress" @pointerdown.stop="onSeekStart" @click.stop>
        <i class="audio-seek-track"></i>
        <span class="audio-seek-fill" :style="{ width: pct + '%' }"></span>
        <b class="audio-seek-thumb" :style="{ left: pct + '%' }"></b>
        <span class="audio-time audio-time-cur">{{ fmtDur(current) }}</span>
        <span class="audio-time audio-time-dur">{{ fmtDur(duration) }}</span>
      </div>
    </div>

    <a
      class="media-dl"
      :href="src"
      :download="name || ''"
      :title="tr('chat.media.download')"
      :aria-label="tr('chat.media.download')"
      @click.stop
    >
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.55l3.6-3.6 1.42 1.42-6 6-6-6 1.42-1.42L11 13.55V3h1zm-7 16h14v2H5v-2z"/></svg>
    </a>

    <audio
      ref="audio"
      :src="src"
      preload="metadata"
      @play="onPlay"
      @pause="onStop"
      @ended="onStop"
      @loadedmetadata="onLoaded"
      @timeupdate="onTime"
    ></audio>
  </div>
</template>
