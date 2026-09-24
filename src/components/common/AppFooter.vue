<script setup lang="ts">
/* ============================================================
 * 页脚：版权 + 项目地址
 * 登录页底部与聊天页侧栏底部共用（样式走 Tailwind，两页都加载了 tailwind.css）。
 * align：侧栏里的内容都是左对齐的，页脚跟着左对齐才不突兀；登录页居中。
 * ============================================================ */
import { tr } from '../core/i18n';

const year = new Date().getFullYear();
const REPO = 'https://github.com/CircleChat-Team/CircleChat';
const DOCS = 'https://circlechat-team.github.io/CircleChat-Docs/';
withDefaults(defineProps<{ align?: 'left' | 'center' }>(), { align: 'center' });
</script>

<template>
  <!-- 弱化：比正文更小一号、默认 60% 不透明度，鼠标移上去才变清晰，避免抢视觉 -->
  <footer
    class="app-footer flex flex-wrap items-center gap-x-1.5 gap-y-0.5 py-2 text-[10px] text-muted opacity-60 transition-opacity hover:opacity-100"
    :class="align === 'left' ? 'justify-start text-left' : 'justify-center text-center'"
  >
    <span>© {{ year }} CircleChat</span>
    <span aria-hidden="true">·</span>
    <a
      class="transition-opacity hover:text-primary"
      :href="REPO"
      target="_blank"
      rel="noopener noreferrer"
    >GitHub</a>
    <span aria-hidden="true">·</span>
    <a
      class="transition-opacity hover:text-primary"
      :href="DOCS"
      target="_blank"
      rel="noopener noreferrer"
    >{{ tr('common.docs') }}</a>
  </footer>
</template>
