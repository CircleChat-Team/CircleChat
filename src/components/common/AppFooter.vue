<script setup lang="ts">
/* ============================================================
 * 页脚：版权 + 项目地址
 * 登录页与聊天页侧栏底部共用（样式走 Tailwind，两页都加载了 tailwind.css）。
 * ============================================================ */
const year = new Date().getFullYear();
const REPO = 'https://github.com/CircleChat-Team/CircleChat';
</script>

<template>
  <footer class="app-footer flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 py-2 text-center text-[11px] text-muted">
    <span>© {{ year }} CircleChat</span>
    <span aria-hidden="true">·</span>
    <a
      class="transition-opacity hover:text-primary"
      :href="REPO"
      target="_blank"
      rel="noopener noreferrer"
    >GitHub</a>
  </footer>
</template>
