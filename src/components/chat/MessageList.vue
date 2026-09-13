<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { chatState, loadOlder, openForward, toggleSelectMode } from '../../core/chat';
import { tr } from '../../core/i18n';
import MessageItem from './MessageItem.vue';

const listEl = ref<HTMLElement | null>(null);
const nearBottom = ref(true);
const visible = computed(() => chatState.messages.slice(chatState.topIndex));

function scrollToBottom(): void {
  const el = listEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function onScroll(): void {
  const el = listEl.value;
  if (!el) return;
  nearBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
  if (el.scrollTop < 80 && chatState.topIndex > 0) {
    const prevH = el.scrollHeight;
    const prevTop = el.scrollTop;
    loadOlder();
    nextTick(() => {
      const e2 = listEl.value;
      if (e2) e2.scrollTop = prevTop + (e2.scrollHeight - prevH);
    });
  }
}

onMounted(() => nextTick(scrollToBottom));
watch(
  () => chatState.messages.length,
  () => {
    if (nearBottom.value) nextTick(scrollToBottom);
  }
);
watch(
  () => chatState.messages,
  () => nextTick(scrollToBottom)
);
</script>

<template>
  <div ref="listEl" class="msg-list" @scroll="onScroll">
    <p v-if="!visible.length" class="sys-msg">
      {{ chatState.loadingHistory ? '…' : tr('chat.history.empty') }}
    </p>
    <MessageItem
      v-for="(m, i) in visible"
      :key="m.idx ?? 'tmp' + i"
      :msg="m"
      :prev="i > 0 ? visible[i - 1] : undefined"
    />
    </div>

    <div v-if="chatState.selectMode" class="select-bar">
    <span class="select-count">{{ tr('chat.select.count', { n: chatState.selected.length }) }}</span>
    <div class="select-actions">
    <button
      type="button"
      class="sel-btn"
      :disabled="!chatState.selected.length"
      @click="openForward(chatState.selected.slice(), 'single')"
    >{{ tr('chat.forward.individual') }}</button>
    <button
      type="button"
      class="sel-btn primary"
      :disabled="!chatState.selected.length"
      @click="openForward(chatState.selected.slice(), 'merge')"
    >{{ tr('chat.forward.merge') }}</button>
    <button type="button" class="sel-btn" @click="toggleSelectMode">{{ tr('chat.select.cancel') }}</button>
    </div>
    </div>
    </template>
