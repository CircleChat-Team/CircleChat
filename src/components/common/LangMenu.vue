<script setup lang="ts">
// 语言切换菜单
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { languages, setLang, langState, tr } from '../../core/i18n';

const props = withDefaults(defineProps<{ up?: boolean }>(), { up: false });

const open = ref(false);
const items = computed(() => languages());
const cur = computed(() => langState.lang);

function close(): void {
  open.value = false;
}
function toggle(): void {
  open.value = !open.value;
}
function onDocClick(): void {
  if (open.value) close();
}
function onKey(e: KeyboardEvent): void {
  if (open.value && (e.key === 'Escape' || e.keyCode === 27)) close();
}

onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});

function pick(code: string): void {
  setLang(code);
  close();
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-fill hover:text-ink"
      :title="tr('common.lang')"
      :aria-label="tr('common.lang')"
      aria-haspopup="true"
      :aria-expanded="open ? 'true' : 'false'"
      @click.stop="toggle"
    >
      <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path
          d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.95a15.6 15.6 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4.06c.83 1.2 1.5 2.53 1.93 3.94h-3.86A14.6 14.6 0 0 1 12 4.06zM4.26 14A8.1 8.1 0 0 1 4 12c0-.69.09-1.36.26-2h3.38c-.09.66-.14 1.32-.14 2s.05 1.34.14 2H4.26zm.84 2h2.95c.34 1.28.82 2.5 1.4 3.6A8 8 0 0 1 5.1 16zm2.95-8H5.1a8 8 0 0 1 4.35-3.6A15.6 15.6 0 0 0 8.05 8zM12 19.94A14.6 14.6 0 0 1 10.07 16h3.86A14.6 14.6 0 0 1 12 19.94zM14.34 14H9.66c-.1-.66-.16-1.32-.16-2s.06-1.35.16-2h4.68c.1.65.16 1.32.16 2s-.06 1.34-.16 2zm.21 5.6c.58-1.1 1.06-2.32 1.4-3.6h2.95a8 8 0 0 1-4.35 3.6zM16.36 14c.09-.66.14-1.32.14-2s-.05-1.34-.14-2h3.38c.17.64.26 1.31.26 2s-.09 1.36-.26 2h-3.38z"
        />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute right-0 z-20 min-w-[120px] overflow-hidden rounded-xl border border-line bg-panel py-1 shadow-lg"
      :class="props.up ? 'bottom-full mb-1' : 'top-full mt-1'"
      role="menu"
      @click.stop
    >
      <button
        v-for="l in items"
        :key="l.code"
        type="button"
        role="menuitemradio"
        :aria-checked="l.code === cur ? 'true' : 'false'"
        class="block w-full px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-fill"
        :class="l.code === cur ? 'font-semibold text-primary' : 'text-ink'"
        @click="pick(l.code)"
      >
        {{ l.name }}
      </button>
    </div>
  </div>
</template>
