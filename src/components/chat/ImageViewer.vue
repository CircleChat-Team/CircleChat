<script setup lang="ts">
/* ============================================================
 * 图片灯箱：站内大图查看（不再打开新标签页）
 * ============================================================ */
import { computed } from 'vue';
import { chatState, closeImageView } from '../../core/chat';

const src = computed(() => chatState.imageView);
</script>

<template>
  <div v-if="src" class="imgview-mask" @click.self="closeImageView">
    <button type="button" class="imgview-close" aria-label="close" @click="closeImageView">×</button>
    <img class="imgview-img" :src="src" alt="" @click.stop />
  </div>
</template>
