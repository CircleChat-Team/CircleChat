<script setup lang="ts">
/* ============================================================
 * 自定义样式（独立弹窗）：亮/暗两套配色各设 背景 / 面板 / 文字 + 恢复默认
 * ============================================================ */
import { computed } from 'vue';
import { tr } from '../../core/i18n';
import {
  accent,
  setAccent,
  customStyles,
  customTheme,
  setCustomPart,
  resetCustom,
  styleWarning,
  type ThemeName,
} from '../../core/theme';
import { chatState, closeStyle } from '../../core/chat';

const cur = computed(() => customStyles.value[customTheme.value]);
const anyCustom = (): boolean =>
  !!accent.value ||
  !!cur.value.bg || !!cur.value.panel || !!cur.value.text;

function pickTheme(t: ThemeName): void {
  customTheme.value = t;
}
function onAccent(e: Event): void {
  setAccent((e.target as HTMLInputElement).value);
}
function onBg(e: Event): void {
  setCustomPart(customTheme.value, 'bg', (e.target as HTMLInputElement).value);
}
function onPanel(e: Event): void {
  setCustomPart(customTheme.value, 'panel', (e.target as HTMLInputElement).value);
}
function onText(e: Event): void {
  setCustomPart(customTheme.value, 'text', (e.target as HTMLInputElement).value);
}
function onResetStyle(): void {
  setAccent('');
  resetCustom(customTheme.value);
}
</script>

<template>
  <div
    v-if="chatState.styleOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="closeStyle"
  >
    <div class="relative w-[22rem] max-w-full overflow-hidden rounded-2xl bg-panel text-ink shadow-xl">
      <div class="border-b border-line px-5 py-4 text-center text-base font-semibold">
        {{ tr('profile.style.label') }}
      </div>

      <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
        <div class="mb-3 flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors"
            :class="customTheme === 'light' ? 'border-primary text-primary' : 'border-line text-muted'"
            @click="pickTheme('light')"
          >{{ tr('common.light') }}</button>
          <button
            type="button"
            class="flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors"
            :class="customTheme === 'dark' ? 'border-primary text-primary' : 'border-line text-muted'"
            @click="pickTheme('dark')"
          >{{ tr('common.dark') }}</button>
        </div>

        <div class="space-y-2">
          <label class="flex items-center justify-between">
            <span class="text-sm">{{ tr('profile.style.bg') }}</span>
            <input type="color" class="accent-input" :value="cur.bg || '#f5f5f7'" @input="onBg" />
          </label>
          <label class="flex items-center justify-between">
            <span class="text-sm">{{ tr('profile.style.panel') }}</span>
            <input type="color" class="accent-input" :value="cur.panel || '#ffffff'" @input="onPanel" />
          </label>
          <label class="flex items-center justify-between">
            <span class="text-sm">{{ tr('profile.style.text') }}</span>
            <input type="color" class="accent-input" :value="cur.text || '#1d1d1f'" @input="onText" />
          </label>
        </div>

        <div class="mt-4 border-t border-line pt-4">
          <label class="flex items-center justify-between">
            <span class="text-sm">{{ tr('profile.style.primary') }}</span>
            <input type="color" class="accent-input" :value="accent || '#07c160'" @input="onAccent" />
          </label>
        </div>

        <p v-if="styleWarning" class="mt-3 text-xs text-danger">{{ tr('profile.style.lowContrast') }}</p>
        <button
          type="button"
          class="btn-mini btn-ghost mt-4 w-full"
          :disabled="!anyCustom()"
          @click="onResetStyle"
        >{{ tr('profile.style.reset') }}</button>
      </div>

      <button
        type="button"
        class="absolute right-3 top-2.5 text-2xl leading-none text-muted"
        :title="tr('common.close')"
        @click="closeStyle"
      >×</button>
    </div>
  </div>
</template>