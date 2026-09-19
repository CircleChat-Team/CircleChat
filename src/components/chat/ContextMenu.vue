<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, nextTick, watch } from 'vue';
import { chatState, openForward, recall, copyToClipboard, copyImage, startSelectWith, reportMessage } from '../../core/chat';
import { tr } from '../../core/i18n';
import { prompt } from '../../core/dialog';

const menu = computed(() => chatState.contextMenu);
const msg = computed(() => {
  const m = menu.value;
  if (!m) return null;
  return chatState.messages.find((x) => x.idx === m.idx) || null;
});
const canRecall = computed(() => {
  const m = msg.value;
  return !!m && (m.from === chatState.me || chatState.isAdmin);
});

// 实际渲染坐标：打开菜单时测量尺寸，夹取到视口内，避免超出屏幕
const menuEl = ref<HTMLElement | null>(null);
const pos = ref({ x: 0, y: 0 });

function reposition(): void {
  const m = menu.value;
  const el = menuEl.value;
  if (!m || !el) return;
  const rect = el.getBoundingClientRect();
  const margin = 8;
  let x = m.x;
  let y = m.y;
  if (x + rect.width > window.innerWidth - margin) {
    x = Math.max(margin, window.innerWidth - rect.width - margin);
  }
  if (y + rect.height > window.innerHeight - margin) {
    y = Math.max(margin, window.innerHeight - rect.height - margin);
  }
  pos.value = { x, y };
}

watch(menu, async () => {
  if (!menu.value) return;
  await nextTick();
  reposition();
}, { immediate: true });

function close(): void {
  chatState.contextMenu = null;
}
function onReact(): void {
  if (msg.value && msg.value.idx != null) chatState.reactTargetIdx = msg.value.idx;
  close();
}
function onReply(): void {
  if (msg.value) chatState.replyTo = msg.value;
  close();
}
function onCopy(): void {
  const m = msg.value;
  if (!m) { close(); return; }
  if (m.type === 'image') {
    // 图片：优先把图片本身写入剪贴板，失败再回退为复制地址
    copyImage(m.content || '').then((ok) => { if (!ok) copyToClipboard(m.content || ''); });
  } else {
    copyToClipboard(m.content || '');
  }
  close();
}
function onForward(): void {
  if (msg.value && msg.value.idx != null) openForward([msg.value.idx], 'single');
  close();
}
function onMulti(): void {
  if (msg.value && msg.value.idx != null) startSelectWith(msg.value.idx);
  close();
}
function onRecall(): void {
  if (msg.value && msg.value.idx != null) recall(msg.value.idx);
  close();
}
function onReport(): void {
  const m = msg.value;
  if (!m || m.idx == null || m.from === chatState.me) { close(); return; }
  prompt({
    title: tr('chat.report.title'),
    text: tr('chat.report.prompt'),
    placeholder: tr('chat.report.placeholder'),
    okText: tr('chat.report.submit'),
    input: { type: 'text', placeholder: tr('chat.report.placeholder'), maxLength: 200 }
  }).then((reason) => {
    close();
    if (reason == null) return;
    const v = reason.trim();
    if (!v) return;
    reportMessage(m.idx!, v).then((ok) => {
      alert(ok ? tr('chat.report.done') : tr('chat.report.fail'));
    });
  });
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}

onMounted(() => {
  document.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', reposition);
});
onUnmounted(() => {
  document.removeEventListener('click', close);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', reposition);
});
</script>

<template>
  <div
    v-if="menu"
    ref="menuEl"
    class="ctx-menu"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @click.stop
  >
    <button type="button" class="ctx-item" @click="onReact">{{ tr('chat.ctx.react') }}</button>
    <button type="button" class="ctx-item" @click="onReply">{{ tr('chat.ctx.reply') }}</button>
    <button type="button" class="ctx-item" @click="onCopy">{{ tr('chat.ctx.copy') }}</button>
    <button type="button" class="ctx-item" @click="onForward">{{ tr('chat.ctx.forward') }}</button>
    <button type="button" class="ctx-item" @click="onMulti">{{ tr('chat.ctx.multi') }}</button>
    <button v-if="canRecall" type="button" class="ctx-item danger" @click="onRecall">{{ tr('chat.ctx.recall') }}</button>
    <button v-if="msg && msg.from !== chatState.me" type="button" class="ctx-item danger" @click="onReport">{{ tr('chat.ctx.report') }}</button>
  </div>
</template>
