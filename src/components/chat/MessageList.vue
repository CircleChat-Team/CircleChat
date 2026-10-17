<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import {
  chatState,
  loadOlder,
  openForward,
  toggleSelectMode,
  canSpeakInActiveRoom,
  dismissJoinHint,
  sendWelcome,
  type JoinHint
} from '../../core/chat';
import { tr } from '../../core/i18n';
import { fmtDate } from '../../core/format';
import type { ChatMessage } from '../../types';
import MessageItem from './MessageItem.vue';

const listEl = ref<HTMLElement | null>(null);
const nearBottom = ref(true);
/** 用户离开底部时累计的新消息条数（用于「N 条新消息」提示） */
const pending = ref(0);
const visible = computed(() => chatState.messages.slice(chatState.topIndex));
/** 当前这个群的新成员入群提示 */
const joinHints = computed(() =>
  chatState.activeGid == null ? [] : chatState.joinHints.filter((h) => h.gid === chatState.activeGid)
);
/** 我此刻能不能发言：不能发言时不给「发送欢迎」链接，免得点了没反应 */
const canSpeak = computed(() => canSpeakInActiveRoom());

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
/** 一次向上加载流程是否正在进行：滚动事件会连续触发，必须串行化，否则多次重锚互相打架 */
let loadingOlder = false;
/** 重锚定窗口内用户是否有主动滚动操作：有就立刻让位，避免与它抢位置 */
let interrupted = false;

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
  if (el.scrollTop < 80 && !nearBottom.value && chatState.topIndex > 0) void loadOlderSafely();
}

/**
 * 向上加载更早的消息。
 *
 * 抽搐的两个根因：
 * 1) 老消息里的图片 / 音视频是异步增高的，一次性按「高度差」补 scrollTop 会持续偏；
 * 2) 浏览器自带的滚动锚定（overflow-anchor）与我们的补偿同时生效，两边互相纠正 → 上下弹。
 *
 * 对策：容器上关掉 overflow-anchor（见 chat.css 的 .msg-list），改由这里以
 * 「锚点元素」为准逐帧校正 —— 插入前后锚点相对视口顶部的偏移量保持不变即可。
 * 锚点元素取<插入后仍在视口里的第一条消息>，它下面的高度怎么变都影响不到它。
 */
async function loadOlderSafely(): Promise<void> {
  const el = listEl.value;
  if (!el || loadingOlder) return;
  if (chatState.topIndex <= 0) return;
  loadingOlder = true;
  anchoring = true;
  interrupted = false;
  // 期间强制瞬时滚动：平滑滚动的动画会被后续的逐帧校正反复打断，反而更抖
  const prevBehavior = el.style.scrollBehavior;
  el.style.scrollBehavior = 'auto';
  // 用户在这期间主动操作（滚轮 / 触摸 / 键盘）就立刻让位，不跟他抢滚动位置
  const stop = () => {
    interrupted = true;
  };
  el.addEventListener('wheel', stop, { passive: true, once: true });
  el.addEventListener('touchstart', stop, { passive: true, once: true });
  el.addEventListener('pointerdown', stop, { passive: true, once: true });
  const clean = () => {
    el.removeEventListener('wheel', stop);
    el.removeEventListener('touchstart', stop);
    el.removeEventListener('pointerdown', stop);
  };

  const anchor = firstVisibleRow(el);
  // 锚点在插入前相对可视区顶部的偏移（校正目标）
  const offset = anchor ? anchor.getBoundingClientRect().top - el.getBoundingClientRect().top : 0;
  // 兜底：整屏都是系统提示行（没有 data-msg-row）时，退回按高度差补偿
  const prevH = el.scrollHeight;
  const prevTop = el.scrollTop;

  loadOlder();
  await nextTick(); // 等 Vue 把老消息真正塞进 DOM 再量高度，之前的位置测量才有意义
  settleAnchor(el, anchor, offset, prevH, prevTop, 0, prevBehavior, clean);
}

/** 视口里最靠上的那条消息（插入点上方的新内容不会把它挤走，适合当锚点） */
function firstVisibleRow(el: HTMLElement): HTMLElement | null {
  const rows = el.querySelectorAll<HTMLElement>('[data-msg-row]');
  if (!rows.length) return null;
  const box = el.getBoundingClientRect();
  for (const r of rows) {
    if (r.getBoundingClientRect().bottom > box.top + 1) return r;
  }
  return rows[rows.length - 1];
}

/**
 * 逐帧把锚点摆回原位，直到位置不再变化（或达上限）。
 * 用户的主动滚动 / 触摸会中断校正，避免和正在翻历史的手指打架。
 */
function settleAnchor(
  el: HTMLElement,
  anchor: HTMLElement | null,
  offset: number,
  prevH: number,
  prevTop: number,
  frames: number,
  behavior: string,
  clean: () => void
): void {
  const finish = (keepNearBottom: boolean) => {
    el.style.scrollBehavior = behavior;
    anchoring = false;
    loadingOlder = false;
    clean();
    // 被用户打断时不改 nearBottom：后面的 onScroll 会给出真实结果
    if (!keepNearBottom) nearBottom.value = false; // 用户在翻历史，不应被视为「在底部」
  };
  if (listEl.value !== el) {
    loadingOlder = false;
    anchoring = false;
    clean();
    return;
  }
  if (interrupted) {
    finish(true);
    return;
  }
  let moved = false;
  if (anchor && anchor.isConnected) {
    const drift = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - offset;
    if (Math.abs(drift) > 0.5) {
      el.scrollTop += drift;
      moved = true;
    }
  } else {
    // 没有可锚定的消息行：按高度差补偿
    const want = prevTop + (el.scrollHeight - prevH);
    if (Math.abs(want - el.scrollTop) > 0.5) {
      el.scrollTop = want;
      moved = true;
    }
  }
  // 位置稳定且已过一帧以上：图片等异步内容多半已就位，收工
  const done = !moved && frames > 0;
  if (done || frames >= 40) {
    finish(false);
    return;
  }
  requestAnimationFrame(() => settleAnchor(el, anchor, offset, prevH, prevTop, frames + 1, behavior, clean));
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

    <!-- 新成员入群：中间小提示，旁边的链接一键发出欢迎消息（发了就撤掉这条提示） -->
    <div v-for="h in joinHints" :key="'join' + h.id" class="join-hint">
      <span class="join-hint-text">{{ tr('chat.group.joinHint', { name: h.name }) }}</span>
      <button v-if="canSpeak" type="button" class="join-hint-link" @click="sendWelcome(h as JoinHint)">
        {{ tr('chat.group.joinWelcome') }}
      </button>
      <button
        type="button"
        class="join-hint-close"
        :title="tr('common.close')"
        :aria-label="tr('common.close')"
        @click="dismissJoinHint((h as JoinHint).id)"
      >×</button>
    </div>

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
