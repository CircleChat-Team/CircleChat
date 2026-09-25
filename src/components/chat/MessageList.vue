<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { chatState, loadOlder, openForward, toggleSelectMode } from '../../core/chat';
import { tr } from '../../core/i18n';
import { fmtDate } from '../../core/format';
import type { ChatMessage } from '../../types';
import MessageItem from './MessageItem.vue';

const listEl = ref<HTMLElement | null>(null);
const nearBottom = ref(true);
/** 用户离开底部时累计的新消息条数（用于「N 条新消息」提示） */
const pending = ref(0);
const visible = computed(() => chatState.messages.slice(chatState.topIndex));

// 日期分隔线：跨天时在两条消息之间插入「今天 / 昨天 / 具体日期」胶囊。
function tsOf(m: ChatMessage): number {
  return Number(m.ts || m.time || 0);
}
function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function showDaySep(i: number): boolean {
  const list = visible.value;
  const cur = list[i];
  if (!cur) return false;
  if (i === 0) return true;
  return dayStart(tsOf(list[i - 1])) !== dayStart(tsOf(cur));
}
function dayLabel(m: ChatMessage): string {
  const today = dayStart(Date.now());
  const day = dayStart(tsOf(m));
  if (day === today) return tr('chat.date.today');
  if (day === today - 86400000) return tr('chat.date.yesterday');
  return fmtDate(tsOf(m));
}
/** 进入会话后的「强制贴底」截止时刻（ms）：期间媒体/图片异步增高高度也不能打断，直接拉到底 */
let forceUntil = 0;
/** 监听滚动容器高度变化（正在输入/上传占位层、软键盘等），贴底时自动重贴，保持最新消息可见 */
let ro: ResizeObserver | null = null;
/** 正在顶部插入老消息并重锚定滚动位置：期间拦截程序滚动，避免被 ResizeObserver 拉回底部 */
let anchoring = false;
let anchorUntil = 0;

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
  // 正在把老消息插入顶部并重锚定：忽略本次（程序触发）滚动，避免递归触发 / 被拉回底部
  if (anchoring) return;
  nearBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
  if (nearBottom.value) pending.value = 0;
  if (el.scrollTop < 80 && !nearBottom.value && chatState.topIndex > 0) {
    const prevH = el.scrollHeight;
    const prevTop = el.scrollTop;
    anchoring = true;
    anchorUntil = Date.now() + 600;
    loadOlder();
    restoreAnchor(prevH, prevTop, 0);
  }
}

/**
 * 加载更早消息（在顶部插入）后，把视口锚定在「插入前看到的那条消息」上：
 * 用 prevTop + 高度增量重设 scrollTop。老消息里的图片/音视频会异步增高，
 * 这里在一段窗口内每帧重锚几次，等高度稳定；期间 ResizeObserver 与 onScroll 都被
 * anchoring 拦住，不会把正在翻历史的人拽回底部。窗口结束后显式置 nearBottom=false。
 */
function restoreAnchor(prevH: number, prevTop: number, depth: number): void {
  const el = listEl.value;
  if (!el) {
    anchoring = false;
    return;
  }
  el.scrollTop = prevTop + (el.scrollHeight - prevH);
  if (depth < 8 && Date.now() < anchorUntil) {
    requestAnimationFrame(() => restoreAnchor(prevH, prevTop, depth + 1));
  } else {
    anchoring = false;
    nearBottom.value = false; // 用户在翻历史，不应被视为「在底部」
  }
}

onMounted(() => {
  nextTick(forceScrollToBottom);
  // 正在输入 / 上传占位层出现或消失、软键盘弹出等会改变本滚动区高度，
  // 此时若处于贴底（或用户未离开底部）则自动重贴，保证最新消息始终可见、消失后自动恢复。
  const el = listEl.value;
  if (el && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (anchoring) return;
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

    <template v-for="(m, i) in visible" :key="m.idx ?? 'tmp' + i">
      <div v-if="showDaySep(i)" class="day-sep"><span>{{ dayLabel(m) }}</span></div>
      <!-- 新的一天第一条强制显示头像（prev=undefined 打破跨日 5 分钟合并） -->
      <MessageItem :msg="m" :prev="i > 0 && !showDaySep(i) ? visible[i - 1] : undefined" />
    </template>

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
