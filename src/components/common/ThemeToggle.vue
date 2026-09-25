<script setup lang="ts">
// 深色模式切换按钮
import { computed } from 'vue';
import { theme, toggleTheme } from '../../core/theme';
import { tr } from '../../core/i18n';

const isDark = computed(() => theme.value === 'dark');
</script>

<template>
  <button
    type="button"
    class="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-fill hover:text-ink"
    :title="tr('common.theme')"
    :aria-label="tr('common.theme')"
    @click="toggleTheme"
  >
    <svg v-if="isDark" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm-9-3H1v2h2v-2zm20 0h-2v2h2v-2zM6.34 6.34 4.93 4.93l1.41-1.41 1.41 1.41L6.34 6.34zm12.02 12.02-1.41 1.41 1.41 1.41 1.41-1.41-1.41-1.41zM4.93 19.07l1.41-1.41 1.41 1.41-1.41 1.41-1.41-1.41zm12.02-12.02 1.41-1.41 1.41 1.41-1.41 1.41-1.41-1.41z"
      />
    </svg>
    <svg v-else class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.33-9.62A9.05 9.05 0 0 0 12 3z" />
    </svg>
  </button>
</template>
