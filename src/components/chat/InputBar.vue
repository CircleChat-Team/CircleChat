<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { chatState, sendText, uploadFiles, notifyTyping, dmgating } from '../../core/chat';
import { tr } from '../../core/i18n';
import EmojiPanel from './EmojiPanel.vue';

const text = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);
const showEmoji = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const dragDepth = ref(0);
const showMention = ref(true);

const gating = computed(() => dmgating());
const reply = computed(() => chatState.replyTo);
const typing = computed(() => chatState.typingWho);

const replyText = computed(() => {
  const r = chatState.replyTo;
  if (!r) return '';
  if (r.type === 'image') return tr('chat.quote.image');
  if (r.type === 'file') return tr('chat.quote.file', { name: r.name || '' });
  return String(r.content || '').replace(/\s+/g, ' ').trim();
});

// @提及候选：检测光标前未完成的 @词
const mention = computed(() => {
  const m = /@([^\s@]*)$/.exec(text.value);
  if (!m || !showMention.value) return null;
  const q = m[1].toLowerCase();
  const list = chatState.allUsers
    .map((u) => u.name)
    .filter((n) => n.toLowerCase().indexOf(q) !== -1)
    .slice(0, 8);
  return list.length ? { start: m.index, list } : null;
});

function autoGrow(): void {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
function onInput(): void {
  autoGrow();
  notifyTyping();
}
function send(): void {
  sendText(text.value);
  text.value = '';
  showMention.value = true;
  nextTick(autoGrow);
  showEmoji.value = false;
}
function onKey(e: KeyboardEvent): void {
  if (mention.value) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(mention.value!.list[0]);
      return;
    }
    if (e.key === 'Escape') {
      showMention.value = false;
      return;
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}
function insertMention(name: string): void {
  const m = mention.value;
  if (!m) return;
  text.value = text.value.slice(0, m.start) + '@' + name + ' ';
  showMention.value = false;
  nextTick(() => {
    textarea.value?.focus();
    autoGrow();
  });
}
function pickEmoji(e: string): void {
  const el = textarea.value;
  if (!el) {
    text.value += e;
    return;
  }
  const s = el.selectionStart ?? text.value.length;
  const t = el.selectionEnd ?? text.value.length;
  text.value = text.value.slice(0, s) + e + text.value.slice(t);
  nextTick(() => {
    el.focus();
    el.selectionStart = el.selectionEnd = s + e.length;
    autoGrow();
  });
}
function openImage(): void {
  if (fileInput.value) {
    fileInput.value.accept = 'image/*';
    fileInput.value.click();
  }
}
function openFile(): void {
  if (gating.value) return;
  if (fileInput.value) {
    fileInput.value.accept = '';
    fileInput.value.click();
  }
}
function onFile(e: Event): void {
  const inp = e.target as HTMLInputElement;
  if (inp.files && inp.files.length) uploadFiles(inp.files);
  inp.value = '';
}
function onDrop(e: DragEvent): void {
  dragDepth.value = 0;
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    e.preventDefault();
    uploadFiles(e.dataTransfer.files);
  }
}
function isFileDrag(e: DragEvent): boolean {
  return !!(e.dataTransfer && Array.from(e.dataTransfer.types).indexOf('Files') !== -1);
}
function onDragOver(e: DragEvent): void {
  if (isFileDrag(e)) e.preventDefault();
}
function onDragEnter(e: DragEvent): void {
  if (isFileDrag(e)) dragDepth.value++;
}
function onDragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}
function cancelReply(): void {
  chatState.replyTo = null;
}
</script>

<template>
  <footer
    class="chat-inputbar"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <div v-if="dragDepth" class="drop-mask"><div class="drop-tip">{{ tr('chat.dropTip') }}</div></div>

    <div v-if="typing" class="typing-bar">{{ tr('chat.typing', { name: typing }) }}</div>

    <div v-if="reply" class="reply-bar">
      <span class="reply-label">{{ tr('chat.tool.reply') }}</span>
      <span class="reply-from">{{ reply.from === chatState.me ? tr('common.you') : reply.from }}</span>
      <span class="reply-text">{{ replyText }}</span>
      <button class="reply-cancel" type="button" :title="tr('chat.reply.cancel')" @click="cancelReply">×</button>
    </div>

    <div v-if="mention" class="mention-panel">
      <button
        v-for="n in mention.list"
        :key="n"
        type="button"
        class="mention-item"
        @click="insertMention(n)"
      >@{{ n }}</button>
    </div>

    <div v-if="showEmoji" class="emoji-wrap">
      <EmojiPanel @pick="pickEmoji" />
    </div>

    <div class="input-row">
      <button type="button" class="tool-btn" :title="tr('chat.emoji.title')" @click="showEmoji = !showEmoji">😊</button>
      <button type="button" class="tool-btn" :title="tr('chat.sendImage')" @click="openImage">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
        </svg>
      </button>
      <button
        type="button"
        class="tool-btn"
        :title="gating ? tr('chat.dm.fileGated') : tr('chat.sendFile')"
        :disabled="gating"
        @click="openFile"
      >
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16.5 6v11.5a4 4 0 1 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a4 4 0 0 0 8 0V5a5.5 5.5 0 0 0-11 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z" />
        </svg>
      </button>
      <textarea
        ref="textarea"
        v-model="text"
        class="text-input"
        :placeholder="tr('chat.input.placeholder')"
        maxlength="4096"
        rows="1"
        @input="onInput"
        @keydown="onKey"
      ></textarea>
      <button type="button" class="send-btn" :title="tr('chat.send')" @click="send">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
        <span>{{ tr('chat.send') }}</span>
      </button>
    </div>

    <input ref="fileInput" type="file" hidden multiple @change="onFile" />
  </footer>
</template>
