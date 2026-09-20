<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { chatState, loadOlder, openForward, toggleSelectMode } from '../../core/chat';
import { tr } from '../../core/i18n';
import MessageItem from './MessageItem.vue';

const listEl = ref<HTMLElement | null>(null);
const nearBottom = ref(true);
/** 用户离开底部时累计的新消息条数（用于「N 条新消息」提示） */
const pending = ref(0);
const visible = computed(() => chatState.messages.slice(chatState.topIndex));
/** 进入会话后的「强制贴底」截止时刻（ms）：期间媒体/图片异步增高高度也不能打断，直接拉到底 */
let forceUntil = 0;
/** 监听滚动容器高度变化（正在输入/上传占位层、软键盘等），贴底时自动重贴，保持最新消息可见 */
let ro: ResizeObserver | null = null;

function scrollToBottom(): void {
  const el = listEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  nearBottom.value = true;
  pending.value = 0;
}

/**
 * 直接到底且不被打断：进入/切换会话时调用。会话切换后消息与媒体（图片/音视频缩略图）
 * 会异步渲染、滚动高度持续变化，单次 scrollTop 会被 onScroll 重算 nearBottom 而"半途停车"。
 * 这里开启一段受限的贴底窗口，用多帧 rAF + 兜底定时反复拉到最底，期间 onScroll 一律忽略中断。
 */
function forceScrollToBottom(): void {
  const el = listEl.value;
  if (!el) return;
  // 强制贴底期间临时关闭 CSS 平滑滚动（scroll-behavior:smooth 的动画可被打断、造成"滚到一半停住"）
  el.style.scrollBehavior = 'auto';
  forceUntil = Date.now() + 700;
  const reach = () => {
    const e = listEl.value;
    if (!e) return;
    if (Date.now() >= forceUntil) {
      e.style.scrollBehavior = '';
      return;
    }
    e.scrollTop = e.scrollHeight;
    nearBottom.value = true;
    pending.value = 0;
  };
  for (let i = 0; i < 8; i++) requestAnimationFrame(reach);
  window.setTimeout(reach, 320);
  window.setTimeout(() => {
    const e = listEl.value;
    if (e) e.style.scrollBehavior = '';
  }, 760);
}

function onScroll(): void {
  const el = listEl.value;
  if (!el) return;
  // 强制贴底期：忽略程序滚动带来的中间态，保持贴底，避免滚动在中途被打断停止
  if (Date.now() < forceUntil) {
    el.scrollTop = el.scrollHeight;
    nearBottom.value = true;
    pending.value = 0;
    return;
  }
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

onMounted(() => {
  nextTick(forceScrollToBottom);
  // 正在输入 / 上传占位层出现或消失、软键盘弹出等会改变本滚动区高度，
  // 此时若处于贴底（或用户未离开底部）则自动重贴，保证最新消息始终可见、消失后自动恢复。
  const el = listEl.value;
  if (el && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (nearBottom.value) scrollToBottom();
    });
    ro.observe(el);
  }
});

onBeforeUnmount(() => {
  if (ro) ro.disconnect();
});

// 只在新消息到来时判断是否跟随：在底部才自动滚，否则改为累计提示，
// 不把正在翻历史的人拽回底部（原实现有个无条件 scrollToBottom 的 deep watch）。
watch(
  () => chatState.messages.length,
  () => {
    // 仍在强制贴底窗口内：续期并继续直接拉到底（媒体异步增高也不会中断）
    if (Date.now() < forceUntil) {
      forceScrollToBottom();
      return;
    }
    // 常规新消息：在底部才自动滚，否则改为累计提示，
    // 不把正在翻历史的人拽回底部
    if (nearBottom.value) nextTick(scrollToBottom);
    else pending.value++;
  }
);

// 切换会话一律强制回到底部：避免带着上一个会话的滚动位置进入新会话，且不被打断
watch(
  () => [chatState.activeGid, chatState.activeDmPeer],
  () => nextTick(forceScrollToBottom)
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
