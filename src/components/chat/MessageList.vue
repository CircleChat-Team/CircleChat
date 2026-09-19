<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { chatState, loadOlder, openForward, toggleSelectMode } from '../../core/chat';
import { tr } from '../../core/i18n';
import MessageItem from './MessageItem.vue';

const listEl = ref<HTMLElement | null>(null);
const nearBottom = ref(true);
/** 用户离开底部时累计的新消息条数（用于「N 条新消息」提示） */
const pending = ref(0);
const visible = computed(() => chatState.messages.slice(chatState.topIndex));

function scrollToBottom(): void {
  const el = listEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  nearBottom.value = true;
  pending.value = 0;
}

function onScroll(): void {
  const el = listEl.value;
  if (!el) return;
  nearBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
  if (nearBottom.value) pending.value = 0;
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

// 只在新消息到来时判断是否跟随：在底部才自动滚，否则改为累计提示，
// 不把正在翻历史的人拽回底部（原实现有个无条件 scrollToBottom 的 deep watch）。
watch(
  () => chatState.messages.length,
  () => {
    if (nearBottom.value) nextTick(scrollToBottom);
    else pending.value++;
  }
);

// 切换会话一律回到底部：避免带着上一个会话的滚动位置进入新会话
watch(
  () => [chatState.activeGid, chatState.activeDmPeer],
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

    <!-- 离开底部时才出现：sticky 贴在可视区底部，不依赖输入栏高度 -->
    <button v-if="!nearBottom" type="button" class="jump-latest" @click="scrollToBottom">
      {{ pending ? tr('chat.list.newMessages', { n: pending }) : tr('chat.list.toLatest') }}
      <span class="jump-arrow">↓</span>
    </button>
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
