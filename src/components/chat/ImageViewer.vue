<script setup lang="ts">
// 图片灯箱：站内大图查看 - 桌面：Esc / 点击背景关闭 - 移动：双击或双指捏合缩放，放大后可拖动，向下滑动关闭
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { chatState, closeImageView } from '../../core/chat';
import { tr } from '../../core/i18n';

const src = computed(() => chatState.imageView);

const scale = ref(1);
const tx = ref(0);
const ty = ref(0);
const dragging = ref(false);

const MAX_SCALE = 4;
const CLOSE_DY = 90; 

const pointers = new Map<number, { x: number; y: number }>();
let pinchBase = 0; 
let panStart = { x: 0, y: 0, tx: 0, ty: 0 };
let dragStart = { x: 0, y: 0 };
let lastTapAt = 0;

function reset(): void {
  scale.value = 1;
  tx.value = 0;
  ty.value = 0;
}

function close(): void {
  reset();
  closeImageView();
}

function dist(): number {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function onPointerDown(e: PointerEvent): void {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  const now = Date.now();
  if (pointers.size === 1) {
    if (now - lastTapAt < 300) {
      if (scale.value > 1) reset();
      else scale.value = 2.5;
      lastTapAt = 0;
      return;
    }
    lastTapAt = now;

    dragStart = { x: e.clientX, y: e.clientY };
    if (scale.value > 1) {
      dragging.value = true;
      panStart = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value };
    }
  }

  if (pointers.size === 2) {
    pinchBase = dist();
    dragging.value = false;
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size >= 2 && pinchBase) {
    const d = dist();
    if (d > 0 && pinchBase > 0) {
      const next = Math.min(MAX_SCALE, Math.max(1, scale.value * (d / pinchBase)));
      scale.value = next;
      pinchBase = d;
      if (next <= 1) {
        tx.value = 0;
        ty.value = 0;
      }
    }
    return;
  }

  if (dragging.value) {
    tx.value = panStart.tx + (e.clientX - panStart.x);
    ty.value = panStart.ty + (e.clientY - panStart.y);
    return;
  }

  const dy = e.clientY - dragStart.y;
  if (dy > 12 && Math.abs(e.clientX - dragStart.x) < 40) {
    ty.value = dy;
    if (dy > CLOSE_DY) close();
  }
}

function onPointerUp(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchBase = 0;
  dragging.value = false;
  // 未放大时回弹（未达到关闭阈值）
  if (scale.value <= 1 && ty.value !== 0) ty.value = 0;
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const next = scale.value * (e.deltaY < 0 ? 1.15 : 1 / 1.15);
  scale.value = Math.min(MAX_SCALE, Math.max(1, next));
  if (scale.value <= 1) {
    tx.value = 0;
    ty.value = 0;
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}

onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="src" class="imgview-mask" @click.self="close">
    <button type="button" class="imgview-close" :aria-label="tr('common.close')" @click="close">×</button>
    <img
      class="imgview-img"
      :class="{ zoomed: scale > 1 }"
      :src="src"
      :alt="tr('chat.image.alt')"
      :style="{ transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')' }"
      draggable="false"
      @click.stop
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onWheel"
    />
  </div>
</template>
