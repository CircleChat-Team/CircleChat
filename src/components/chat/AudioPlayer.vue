<script setup lang="ts">
// 音频消息：点击才播放（不自动播放）；未播放画静态音谱条，播放中切 Web Audio 实时频谱。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { chatState, setVolume, toggleMuteVolume } from '../../core/chat';
import { tr } from '../../core/i18n';
import { fmtSize } from '../../core/format';
import { extOf, fmtDur } from '../../core/media';

const props = defineProps<{ src: string; name?: string; size?: number | null }>();

const audio = ref<HTMLAudioElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const playing = ref(false);
const duration = ref(0);
const current = ref(0);
const seekEl = ref<HTMLElement | null>(null);
/** 是否正在拖动进度（拖动期间忽略 timeupdate，避免进度条被播放位置顶回） */
let seeking = false;
let resumeAfterSeek = false;

const BARS = 28;

const pct = computed(() => {
  const d = duration.value;
  return d > 0 ? Math.min(100, Math.max(0, (current.value / d) * 100)) : 0;
});

function onTime(): void {
  const a = audio.value;
  if (a && isFinite(a.currentTime)) current.value = a.currentTime;
}

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
  if (resumeAfterSeek) a.play().catch(() => {  });
  else current.value = a.currentTime;
}

/* 音量是全局设置（chatState.volume，落库），但 volume 是元素级属性，每个 <audio> 都要各自设一次；
 * 接了 Web Audio 时 createMediaElementSource 取的是元素输出，volume 仍在其之前生效。 */
const volOpen = ref(false);
const volPct = computed(() => Math.round(chatState.volume * 100));
const volMuted = computed(() => chatState.volume <= 0);
const volEl = ref<HTMLElement | null>(null);
let volDragging = false;

function applyVolume(): void {
  const a = audio.value;
  if (a) a.volume = chatState.volume;
}
watch(() => chatState.volume, applyVolume);

function applyVolFromEvent(e: PointerEvent): void {
  const el = volEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  setVolume((e.clientX - r.left) / r.width);
}
function onVolStart(e: PointerEvent): void {
  e.preventDefault();
  e.stopPropagation();
  volDragging = true;
  applyVolFromEvent(e);
  window.addEventListener('pointermove', onVolMove);
  window.addEventListener('pointerup', onVolEnd);
}
function onVolMove(e: PointerEvent): void {
  if (volDragging) applyVolFromEvent(e);
}
function onVolEnd(e: PointerEvent): void {
  if (!volDragging) return;
  volDragging = false;
  window.removeEventListener('pointermove', onVolMove);
  window.removeEventListener('pointerup', onVolEnd);
  applyVolFromEvent(e);
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

/* 频谱条颜色：优先读 canvas 上的 --bars（自己发的消息里 CSS 覆盖成浅色）——
 * 固定取 --primary 会与自己气泡背景同色而看不见。 */
function barColor(): string {
  const c = canvas.value;
  if (c) {
    const v = getComputedStyle(c).getPropertyValue('--bars').trim();
    if (v) return v;
  }
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
  g.fillStyle = barColor();
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

onMounted(() => {
  draw();        // 关键：首帧就画出音谱条，别等播放才出现
  applyVolume(); // 挂载时套用当前音量（设置是异步载入的，watch 会补后续变化）
});
onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
  if (actx) { try { void actx.close(); } catch {  } }
  window.removeEventListener('pointermove', onVolMove);
  window.removeEventListener('pointerup', onVolEnd);
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
        <button
          type="button"
          class="audio-vol-btn"
          :class="{ off: volMuted, open: volOpen }"
          :title="tr('chat.media.volume') + ' ' + volPct + '%'"
          :aria-label="tr('chat.media.volume')"
          :aria-expanded="volOpen"
          @click.stop="volOpen = !volOpen"
        >
          <svg v-if="volMuted" class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 9v6h4l5 4V5L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4-2.7-2.7z" />
          </svg>
          <svg v-else class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
          </svg>
        </button>
        <span class="media-name" :title="name || ''">{{ name || tr('chat.file.defaultName') }}</span>
        <span v-if="tag" class="media-tag">{{ tag }}</span>
      </div>
      <canvas ref="canvas" class="audio-bars" width="240" height="30"></canvas>
      <div ref="seekEl" class="audio-progress" @pointerdown.stop="onSeekStart" @click.stop>
        <i class="audio-seek-track"></i>
        <span class="audio-seek-fill" :style="{ width: pct + '%' }"></span>
        <b class="audio-seek-thumb" :style="{ left: pct + '%' }"></b>
        <span class="audio-time audio-time-cur">{{ fmtDur(current) }}</span>
        <span class="audio-time audio-time-dur">{{ fmtDur(duration) }}</span>
      </div>

      <!-- 音量条：点名字行左侧的喇叭展开；拖动即调音量（全局生效并落库） -->
      <div v-if="volOpen" class="audio-volume" @click.stop>
        <button
          type="button"
          class="audio-vol-mute"
          :title="volMuted ? tr('chat.media.unmute') : tr('chat.media.mute')"
          :aria-label="volMuted ? tr('chat.media.unmute') : tr('chat.media.mute')"
          @pointerdown.stop
          @click.stop="toggleMuteVolume"
        >{{ volMuted ? '🔇' : '🔊' }}</button>
        <span ref="volEl" class="audio-vol-slider" @pointerdown.stop="onVolStart">
          <i class="audio-vol-track"></i>
          <span class="audio-vol-fill" :style="{ width: volPct + '%' }"></span>
          <b class="audio-vol-thumb" :style="{ left: volPct + '%' }"></b>
        </span>
        <span class="audio-vol-num">{{ volPct }}%</span>
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
