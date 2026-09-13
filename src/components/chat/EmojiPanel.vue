<script setup lang="ts">
import { ref, computed } from 'vue';
import { buildEmojiGroups, EMOJI_PER_PAGE } from '../../core/emojis';
import { tr } from '../../core/i18n';

const emit = defineEmits<{ (e: 'pick', emoji: string): void }>();

const groups = buildEmojiGroups();
const gIdx = ref(0);
const pIdx = ref(0);

const group = computed(() => groups[gIdx.value]);
const pageCount = computed(() => Math.max(1, Math.ceil(group.value.emojis.length / EMOJI_PER_PAGE)));
const pageEmojis = computed(() => {
  const s = pIdx.value * EMOJI_PER_PAGE;
  return group.value.emojis.slice(s, s + EMOJI_PER_PAGE);
});

function selectGroup(i: number): void {
  gIdx.value = i;
  pIdx.value = 0;
}
function prev(): void {
  if (pIdx.value > 0) pIdx.value--;
}
function next(): void {
  if (pIdx.value < pageCount.value - 1) pIdx.value++;
}
function pick(e: string): void {
  emit('pick', e);
}
</script>

<template>
  <div class="emoji-panel">
    <div class="emoji-tabs">
      <button
        v-for="(g, i) in groups"
        :key="g.key"
        type="button"
        class="emoji-tab"
        :class="{ active: i === gIdx }"
        :title="tr(g.key)"
        @click="selectGroup(i)"
      >
        {{ g.icon }}
      </button>
    </div>
    <div class="emoji-grid">
      <button
        v-for="(e, i) in pageEmojis"
        :key="i"
        type="button"
        class="emoji-item"
        @click="pick(e)"
      >
        {{ e }}
      </button>
    </div>
    <div class="emoji-pager">
      <button type="button" class="emoji-page-btn" :disabled="pIdx <= 0" @click="prev">‹</button>
      <span class="emoji-page-label">{{ pIdx + 1 }} / {{ pageCount }}</span>
      <button type="button" class="emoji-page-btn" :disabled="pIdx >= pageCount - 1" @click="next">›</button>
    </div>
  </div>
</template>
