<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { chatState, sendText, uploadFiles, notifyTyping, dmgating } from '../../core/chat';
import { tr } from '../../core/i18n';
import EmojiPanel from './EmojiPanel.vue';

const text = ref('');
const md = ref(false); // Markdown 编辑模式：开启后该条按 Markdown 渲染，换行为 Ctrl+Enter
const textarea = ref<HTMLTextAreaElement | null>(null);
const bigEl = ref<HTMLTextAreaElement | null>(null);
const editOpen = ref(false); // 放大编辑器
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

const mutedText = computed(() => {
  if (!chatState.muted) return '';
  return tr('chat.muted.banner');
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
  sendText(text.value, md.value);
  text.value = '';
  showMention.value = true;
  nextTick(autoGrow);
  showEmoji.value = false;
}
function currentEl(): HTMLTextAreaElement | null {
  return editOpen.value ? (bigEl.value || textarea.value) : textarea.value;
}

/** 手动在光标处插入换行，保证 Ctrl+Enter / Shift+Enter 必定能换行 */
function insertNewline(): void {
  const el = currentEl();
  if (el) {
    const s = el.selectionStart ?? text.value.length;
    const t = el.selectionEnd ?? text.value.length;
    el.setRangeText('\n', s, t, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    text.value += '\n';
  }
  nextTick(() => {
    el?.focus();
    if (!editOpen.value) autoGrow();
  });
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
  if (e.key === 'Enter') {
    if (!e.ctrlKey && !e.shiftKey && !e.metaKey) {
      e.preventDefault();
      send();
      return;
    }
    // Ctrl+Enter / Shift+Enter / Cmd+Enter = 换行
    e.preventDefault();
    insertNewline();
  }
}
function toggleMd(): void {
  md.value = !md.value;
  nextTick(() => {
    currentEl()?.focus();
    if (!editOpen.value) autoGrow();
  });
}
function openEditor(): void {
  if (mutedText.value) return;
  editOpen.value = true;
  nextTick(() => {
    const el = bigEl.value;
    if (el) {
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    }
  });
}
function closeEditor(): void {
  editOpen.value = false;
}
function sendEditor(): void {
  if (!text.value.trim()) return;
  send();
  editOpen.value = false;
}
function onInputBig(): void {
  notifyTyping();
}
// 支持粘贴图片/文件：从剪贴板提取文件类内容直接上传
function onPaste(e: ClipboardEvent): void {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items || !items.length) return;
  const files: File[] = [];
  for (const it of Array.from(items)) {
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    uploadFiles(files);
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

    <div v-if="mutedText" class="reply-bar muted-bar">
      <span class="reply-text">{{ mutedText }}</span>
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
        :placeholder="mutedText ? tr('chat.input.mutedPlaceholder') : (md ? tr('chat.input.mdPlaceholder') : tr('chat.input.placeholder'))"
        maxlength="4096"
        rows="1"
        :disabled="!!mutedText"
        @input="onInput"
        @keydown="onKey"
        @paste="onPaste"
      ></textarea>
      <button
        type="button"
        class="tool-btn md-toggle"
        :class="{ on: md }"
        :title="tr('chat.input.mdToggle')"
        :disabled="!!mutedText"
        @click="toggleMd"
      >MD</button>
      <button
        type="button"
        class="tool-btn"
        :title="tr('chat.input.expand')"
        :disabled="!!mutedText"
        @click="openEditor"
      >
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/></svg>
      </button>
      <button type="button" class="send-btn" :title="tr('chat.send')" :disabled="!!mutedText" @click="send">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
        <span>{{ tr('chat.send') }}</span>
      </button>
    </div>

    <input ref="fileInput" type="file" hidden multiple @change="onFile" />
  </footer>

  <!-- 放大编辑器（按钮控制） -->
  <div v-if="editOpen" class="editor-overlay" @click.self="closeEditor">
    <div class="editor-card">
      <textarea
        ref="bigEl"
        v-model="text"
        class="text-input big-input"
        :placeholder="md ? tr('chat.input.mdPlaceholder') : tr('chat.input.placeholder')"
        maxlength="4096"
        @input="onInputBig"
        @keydown="onKey"
        @paste="onPaste"
      ></textarea>
      <div class="editor-toolbar">
        <button
          type="button"
          class="tool-btn md-toggle"
          :class="{ on: md }"
          :title="tr('chat.input.mdToggle')"
          @click="toggleMd"
        >MD</button>
        <span class="editor-hint">{{ tr('chat.input.bigHint') }}</span>
        <div class="editor-actions">
          <button type="button" class="btn-mini btn-ghost" @click="closeEditor">{{ tr('common.cancel') }}</button>
          <button type="button" class="btn-mini btn-primary" @click="sendEditor">{{ tr('chat.send') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
