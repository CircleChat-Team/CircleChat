<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { ChatMessage, MergeData } from '../../types';
import {
  chatState,
  react,
  avatarFor,
  avatarColor,
  clock,
  asset,
  tr,
  canGroup,
  mentionsMe,
  fmtSize,
  getProfile,
  openContextMenu,
  openMergeView,
  openImageView,
  toggleSelect
} from '../../core/chat';
import { QUICK_EMOJIS } from '../../core/emojis';
import TextContent from './TextContent.vue';
import AudioPlayer from './AudioPlayer.vue';

const props = defineProps<{ msg: ChatMessage; prev?: ChatMessage }>();

const showPicker = ref(false);

const grouped = computed(() => canGroup(props.prev, props.msg));
const recalled = computed(() => !!props.msg.recalled);
const expired = computed(() => !!props.msg.file_expired);
const self = computed(() => props.msg.from === chatState.me);
const mentionMe = computed(() => props.msg.type === 'text' && mentionsMe(props.msg.content));
const isSelected = computed(() => props.msg.idx != null && chatState.selected.indexOf(props.msg.idx) !== -1);

const recallTip = computed(() => {
  const by = props.msg.recalled_by || '';
  const adminRecall = by && by !== props.msg.from;
  if (adminRecall) return tr('chat.recall.byAdmin', { admin: by, user: props.msg.from });
  return by === chatState.me ? tr('chat.recall.bySelf') : tr('chat.recall.byOther', { who: by || tr('common.other') });
});

const quoteText = computed(() => {
  const r = props.msg.reply;
  if (!r) return '';
  return String(r.snippet || '').replace(/\s+/g, ' ').trim();
});

// 合并转发卡片
const mergeData = computed<MergeData | null>(() => {
  if (props.msg.type !== 'merge') return null;
  try {
    const o = JSON.parse(props.msg.content || '');
    if (o && Array.isArray(o.items)) return o as MergeData;
  } catch {
    /* 非法内容降级为标题 */
  }
  return null;
});
const mergeTitle = computed(() => (mergeData.value && mergeData.value.title) || tr('chat.merge.label'));
const mergeCount = computed(() => (mergeData.value ? mergeData.value.items.length : 0));
function openMerge(): void {
  if (props.msg.idx != null) openMergeView(props.msg.idx);
}
function openImage(src: string): void {
  openImageView(asset(src));
}

function initial(name: string): string {
  return (name || '?').slice(0, 1);
}
function fileExt(name?: string | null): string {
  const s = String(name || '');
  const i = s.lastIndexOf('.');
  const ext = i >= 0 ? s.slice(i + 1) : '';
  return (ext || '?').slice(0, 4).toUpperCase();
}

function toggleReact(emoji: string): void {
  if (props.msg.idx == null) return;
  react(props.msg.idx, emoji);
  showPicker.value = false;
}
// 触屏设备：用点击（而非长按 / 右键）打开消息操作菜单
const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

function onCtx(e: MouseEvent): void {
  // 桌面端右键打开；移动端不使用长按
  if (isTouch) return;
  if (props.msg.idx != null) openContextMenu(props.msg.idx, e.clientX, e.clientY);
}
function onMsgClick(e: MouseEvent): void {
  if (!isTouch || chatState.selectMode) return;
  const t = e.target as HTMLElement | null;
  if (t && t.closest && t.closest('a, button, .msg-avatar, .msg-select-check, .code-block, .reactions, .quote, .react-picker')) return;
  if (props.msg.idx == null) return;
  // 阻止冒泡到 document，避免 ContextMenu 的全局点击监听把刚打开的菜单立即关掉
  e.stopPropagation();
  openContextMenu(props.msg.idx, e.clientX, e.clientY);
}
function openProfile(): void {
  getProfile(props.msg.from);
}
function jumpTo(idx?: number): void {
  if (idx == null) return;
  const el = document.querySelector('.msg[data-idx="' + idx + '"]');
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('highlight');
    setTimeout(() => el.classList.remove('highlight'), 1400);
  }
}

// 右键菜单选择「回应」后，由全局状态触发本消息弹出表情选择器
watch(
  () => chatState.reactTargetIdx,
  (v) => {
    if (v != null && v === props.msg.idx) {
      showPicker.value = true;
      chatState.reactTargetIdx = null;
    }
  }
);
</script>

<template>
  <div v-if="recalled" class="sys-msg">{{ recallTip }}</div>
  <div
    v-else
    class="msg"
    :class="[self ? 'self' : 'other', { grouped: grouped, 'mention-me': mentionMe }]"
    :data-idx="msg.idx"
    @contextmenu.prevent="onCtx"
    @click="onMsgClick"
  >
    <div class="msg-avatar" @click="!grouped && openProfile()">
      <img v-if="avatarFor(msg.from)" :src="avatarFor(msg.from)!" :alt="msg.from" />
      <span v-else class="avatar-letter" :style="{ background: avatarColor(msg.from) }">{{ initial(msg.from) }}</span>
    </div>

    <div v-if="chatState.selectMode" class="msg-select-check" :class="{ on: isSelected }" @click.stop="toggleSelect(msg.idx)">
      <span v-if="isSelected">✓</span>
    </div>

    <div class="msg-body">
      <div class="meta">
        <span class="meta-text">{{ (self ? '' : msg.from + ' · ') + clock(msg.ts || msg.time) }}</span>
      </div>

      <div v-if="msg.reply" class="quote" @click="jumpTo(msg.reply.idx)">
        <div class="quote-from">{{ msg.reply.from === chatState.me ? tr('common.you') : msg.reply.from }}</div>
        <div class="quote-text">{{ quoteText }}</div>
      </div>

      <div
        v-if="msg.type === 'image' && !expired"
        class="bubble image-bubble"
        @click.stop="openImage(msg.content)"
      >
        <img :src="asset(msg.content)" :alt="msg.name || tr('chat.image.alt')" loading="lazy" />
      </div>
      <video
        v-else-if="msg.type === 'video' && !expired"
        class="video-bubble"
        :src="asset(msg.content)"
        controls
        preload="metadata"
        @click.stop
      ></video>
      <AudioPlayer
        v-else-if="msg.type === 'audio' && !expired"
        :src="asset(msg.content)"
        :name="msg.name || ''"
      />
      <div v-else-if="msg.type === 'text'" class="bubble">
        <TextContent :text="msg.content" md />
      </div>
      <a
        v-else-if="msg.type === 'file' && !expired"
        :href="asset(msg.content)"
        class="file-card"
        target="_blank"
        rel="noopener"
        :download="msg.name || ''"
      >
        <span class="file-badge">{{ fileExt(msg.name) }}</span>
        <span class="file-meta">
          <span class="file-name">{{ msg.name || tr('chat.file.defaultName') }}</span>
          <span class="file-size">{{ fmtSize(msg.size) }}</span>
        </span>
      </a>
      <div v-else-if="msg.type === 'merge'" class="merge-card" @click.stop="openMerge">
        <div class="merge-label">{{ tr('chat.merge.label') }}</div>
        <div class="merge-title">{{ mergeTitle }}</div>
        <div class="merge-sub">{{ tr('chat.merge.summary', { n: mergeCount }) }}</div>
      </div>
      <div v-else class="expired">
        {{ msg.type === 'image' ? tr('chat.file.imageExpired') : tr('chat.file.fileExpired') }}
        <template v-if="msg.name"> · {{ msg.name }}</template>
      </div>

      <div v-if="msg.reactions && msg.reactions.length" class="reactions">
        <button
          v-for="(r, i) in msg.reactions"
          :key="i"
          type="button"
          class="reaction"
          :class="{ mine: r.users.indexOf(chatState.me) !== -1 }"
          @click="toggleReact(r.emoji)"
        >
          <span>{{ r.emoji }}</span><span class="reaction-count">{{ r.users.length }}</span>
        </button>
      </div>

      <div v-if="showPicker" class="react-picker">
        <button
          v-for="e in QUICK_EMOJIS"
          :key="e"
          type="button"
          class="react-emoji"
          @click="toggleReact(e)"
        >
          {{ e }}
        </button>
      </div>
    </div>
  </div>
</template>
