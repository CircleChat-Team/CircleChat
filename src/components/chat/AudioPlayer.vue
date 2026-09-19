<script setup lang="ts">
/* ============================================================
 * 音频消息播放器：播放/暂停 + 实时频谱条（Web Audio AnalyserNode）
 * ============================================================ */
import { onBeforeUnmount, ref } from 'vue';
import { tr } from '../../core/i18n';

defineProps<{ src: string; name?: string }>();

const audio = ref<HTMLAudioElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const playing = ref(false);

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
  const bars = 28;
  const bw = w / bars;
  g.fillStyle = accent();
  if (analyser && freq) {
    analyser.getByteFrequencyData(freq);
    for (let i = 0; i < bars; i++) {
      const v = freq[Math.floor(((i + 1) * freq.length) / (bars + 1))] / 255;
      const bh = Math.max(3, v * (h - 4));
      g.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh);
    }
  } else {
    for (let i = 0; i < bars; i++) g.fillRect(i * bw + 1, h / 2 - 1.5, bw - 2, 3);
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
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  draw();
}

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
  if (actx) { try { void actx.close(); } catch { /* 忽略 */ } }
});
</script>

<template>
  <div class="audio-msg bubble">
    <button
      type="button"
      class="audio-btn"
      :title="playing ? tr('chat.media.pause') : tr('chat.media.play')"
      :aria-label="playing ? tr('chat.media.pause') : tr('chat.media.play')"
      @click.stop="toggle"
    >{{ playing ? '❚❚' : '▶' }}</button>
    <canvas ref="canvas" class="audio-bars" width="200" height="36"></canvas>
    <audio
      ref="audio"
      :src="src"
      preload="metadata"
      @play="onPlay"
      @pause="onStop"
      @ended="onStop"
    ></audio>
  </div>
</template>
