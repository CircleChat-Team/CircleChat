<script setup lang="ts">
/* ============================================================
 * 通用确认 / 输入弹窗视图（对应 src/core/dialog.ts 的状态）
 * 在根组件挂载一次即可：<Dialog />
 * ============================================================ */
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { dialogState, resolveDialog } from '../../core/dialog';
import { tr } from '../../core/i18n';

const inputVal = ref('');
const inputEl = ref<HTMLInputElement | null>(null);

watch(
  () => dialogState.open,
  (open) => {
    if (open) {
      inputVal.value = dialogState.input?.value ?? '';
      requestAnimationFrame(() => {
        if (dialogState.input) inputEl.value?.focus();
      });
    }
  }
);

function onOk(): void {
  if (dialogState.input) {
    if (!inputVal.value) {
      inputEl.value?.focus();
      return;
    }
    resolveDialog(inputVal.value);
  } else {
    resolveDialog(true);
  }
}

function onCancel(): void {
  resolveDialog(null);
}

function onMask(e: MouseEvent): void {
  if (e.target === e.currentTarget) onCancel();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    onCancel();
  }
}

onMounted(() => document.addEventListener('keydown', onKey, true));
onUnmounted(() => document.removeEventListener('keydown', onKey, true));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="dialogState.open"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-5"
      @click="onMask"
    >
      <div
        class="w-[min(320px,100%)] rounded-2xl border border-line bg-panel p-5 shadow-[var(--shadow-pop)]"
        role="dialog"
        aria-modal="true"
      >
        <h3 v-if="dialogState.title" class="text-center text-[15px] font-semibold">{{ dialogState.title }}</h3>
        <p v-if="dialogState.text" class="mt-2 text-center text-[13px] leading-relaxed text-muted">
          {{ dialogState.text }}
        </p>

        <input
          v-if="dialogState.input"
          ref="inputEl"
          v-model="inputVal"
          :type="dialogState.input.type || 'text'"
          :placeholder="dialogState.input.placeholder"
          :maxlength="dialogState.input.maxLength || 64"
          autocomplete="off"
          class="mt-3.5 h-[38px] w-full rounded-xl border border-line bg-fill px-3 text-sm text-ink outline-none focus:border-primary"
          @keydown.enter.prevent="onOk"
        />

        <div class="mt-4 flex gap-2.5">
          <button
            type="button"
            class="flex-1 rounded-xl bg-fill px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-fill-hover active:scale-[.97]"
            @click="onCancel"
          >
            {{ dialogState.cancelText || tr('common.cancel') }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl px-3 py-2 text-sm font-medium text-white transition-colors active:scale-[.97]"
            :class="dialogState.danger ? 'bg-[#e5484d] hover:bg-[#d13b40]' : 'bg-primary hover:bg-primary-dark'"
            @click="onOk"
          >
            {{ dialogState.okText || tr('common.ok') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
