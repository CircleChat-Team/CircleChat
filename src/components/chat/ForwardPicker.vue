<script setup lang="ts">
import { computed, ref } from 'vue';
import { chatState, forwardTo, closeForward, avatarColor } from '../../core/chat';
import { tr } from '../../core/i18n';
import { useOverlay } from '../../core/useOverlay';

const groups = computed(() => chatState.myGroups);
const friends = computed(() => chatState.myFriends);

function initial(name: string): string {
  return (name || '?').slice(0, 1);
}
function pickGroup(gid: string): void {
  forwardTo({ gid });
}
function pickFriend(name: string): void {
  forwardTo({ pm: name });
}
function setMode(m: 'single' | 'merge'): void {
  chatState.forwardMode = m;
}
function close(): void {
  closeForward();
}

// Esc 关闭 + 打开时聚焦弹层 + 关闭后归还焦点
const rootEl = ref<HTMLElement | null>(null);
useOverlay({
  isOpen: () => chatState.forwardOpen,
  onClose: close,
  container: () => rootEl.value
});
</script>

<template>
  <div v-if="chatState.forwardOpen" ref="rootEl" class="forward-mask" @click.self="close">
    <div class="forward-modal">
      <div class="forward-head">
        <span>{{ tr('chat.forward.title') }}</span>
        <button type="button" class="forward-x" @click="close">×</button>
      </div>
      <div class="forward-mode">
        <button
          type="button"
          :class="{ on: chatState.forwardMode === 'single' }"
          @click="setMode('single')"
        >{{ tr('chat.forward.individual') }}</button>
        <button
          type="button"
          :class="{ on: chatState.forwardMode === 'merge' }"
          @click="setMode('merge')"
        >{{ tr('chat.forward.merge') }}</button>
      </div>
      <div class="forward-scroll">
        <div class="forward-sec">{{ tr('chat.sessions') }}</div>
        <button
          v-for="g in groups"
          :key="g.id"
          type="button"
          class="forward-target"
          @click="pickGroup(g.id)"
        >
          <span class="ft-avatar group">#</span>
          <span class="ft-name">{{ g.name }}</span>
        </button>
        <div class="forward-sec">{{ tr('chat.friends') }}</div>
        <button
          v-for="f in friends"
          :key="f.name"
          type="button"
          class="forward-target"
          @click="pickFriend(f.name)"
        >
          <span class="ft-avatar" :style="{ background: avatarColor(f.name) }">{{ initial(f.name) }}</span>
          <span class="ft-name">{{ f.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
