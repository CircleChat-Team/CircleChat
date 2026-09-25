<script setup lang="ts">
// 头像裁剪：上传图片后弹出，拖动定位 + 缩放，确认时导出 512×512 正方形 PNG。 由 core/chat.ts 的 cropAvatarImage() 通过 createApp 挂到 body 上调用。
import { ref, computed, onMounted } from 'vue';
import { tr } from '../../core/i18n';

const props = defineProps<{ file: File }>();
const emit = defineEmits<{ confirm: [blob: Blob]; cancel: [] }>();

const VIEW = 280;
const OUT = 512;
const src = ref('');
const naturW = ref(1);
const naturH = ref(1);
const baseScale = ref(1);
const zoom = ref(1);
const offX = ref(0);
const offY = ref(0);
const busy = ref(false);

const imgStyle = computed(() => {
  const s = baseScale.value * zoom.value;
  return {
    width: naturW.value * s + 'px',
    height: naturH.value * s + 'px',
    transform: `translate(${offX.value}px, ${offY.value}px)`
  };
});

function clamp(): void {
  const s = baseScale.value * zoom.value;
  const dw = naturW.value * s;
  const dh = naturH.value * s;
  offX.value = Math.min(0, Math.max(VIEW - dw, offX.value));
  offY.value = Math.min(0, Math.max(VIEW - dh, offY.value));
}

function onLoad(e: Event): void {
  const img = e.target as HTMLImageElement;
  naturW.value = img.naturalWidth || 1;
  naturH.value = img.naturalHeight || 1;
  baseScale.value = Math.max(VIEW / naturW.value, VIEW / naturH.value);
  zoom.value = 1;
  const s = baseScale.value;
  offX.value = (VIEW - naturW.value * s) / 2;
  offY.value = (VIEW - naturH.value * s) / 2;
}

let dragging = false;
let sx = 0;
let sy = 0;
let sox = 0;
let soy = 0;

function onDown(e: PointerEvent): void {
  dragging = true;
  sx = e.clientX;
  sy = e.clientY;
  sox = offX.value;
  soy = offY.value;
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
}
function onMove(e: PointerEvent): void {
  if (!dragging) return;
  offX.value = sox + (e.clientX - sx);
  offY.value = soy + (e.clientY - sy);
  clamp();
}
function onUp(): void {
  dragging = false;
}

function confirm(): void {
  busy.value = true;
  const s = baseScale.value * zoom.value;
  const canvas = document.createElement('canvas');
  canvas.width = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    const sw = VIEW / s;
    const sh = VIEW / s;
    ctx?.drawImage(img, -offX.value / s, -offY.value / s, sw, sh, 0, 0, OUT, OUT);
    canvas.toBlob((blob) => {
      if (blob) emit('confirm', blob);
      else emit('cancel');
    }, 'image/png');
  };
  img.onerror = () => emit('cancel');
  img.src = src.value;
}

onMounted(() => {
  src.value = URL.createObjectURL(props.file);
});
</script>

<template>
  <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4" @click.self="emit('cancel')">
    <div class="w-[320px] max-w-full rounded-2xl bg-panel p-4 shadow-xl">
      <h3 class="mb-3 text-center text-sm font-semibold">{{ tr('avatar.crop.title') }}</h3>
      <p class="mb-3 text-center text-[11px] text-muted">{{ tr('avatar.crop.hint') }}</p>

      <div
        class="relative mx-auto overflow-hidden rounded-xl border border-line bg-black/20"
        :style="{ width: VIEW + 'px', height: VIEW + 'px' }"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      >
        <img
          v-if="src"
          :src="src"
          alt=""
          draggable="false"
          class="pointer-events-none absolute left-0 top-0 max-w-none select-none"
          :style="imgStyle"
          @load="onLoad"
        >
      </div>

      <div class="mt-3 flex items-center gap-2">
        <span class="shrink-0 text-[11px] text-muted">{{ tr('avatar.crop.zoom') }}</span>
        <input
          v-model.number="zoom"
          type="range"
          min="1"
          max="3"
          step="0.01"
          class="flex-1 accent-primary"
          @input="clamp"
        >
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="emit('cancel')"
        >{{ tr('avatar.crop.cancel') }}</button>
        <button
          type="button"
          class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          :disabled="busy"
          @click="confirm"
        >{{ tr('avatar.crop.confirm') }}</button>
      </div>
    </div>
  </div>
</template>
