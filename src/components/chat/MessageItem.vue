<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { ChatMessage } from '../../types';
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
  toggleSelect
} from '../../core/chat';
import { QUICK_EMOJIS } from '../../core/emojis';
import TextContent from './TextContent.vue';

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
function onCtx(e: MouseEvent): void {
  if (props.msg.idx != null) openContextMenu(props.msg.idx, e.clientX, e.clientY);
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

      <a
        v-if="msg.type === 'image' && !expired"
        :href="asset(msg.content)"
        target="_blank"
        rel="noopener"
        class="bubble image-bubble"
      >
        <img :src="asset(msg.content)" :alt="msg.name || tr('chat.image.alt')" loading="lazy" />
      </a>
      <div v-else-if="msg.type === 'text'" class="bubble">
        <TextContent :text="msg.content" :md="msg.md === 1" />
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
