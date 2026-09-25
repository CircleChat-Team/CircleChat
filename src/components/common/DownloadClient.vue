<script setup lang="ts">
/* ============================================================
 * 桌面客户端下载入口
 *
 * 桌面客户端里再提示「下载客户端」没有意义（它本来就是客户端打开的），
 * 所以命中客户端时整个组件不渲染——判断逻辑统一走 utils/client，
 * 不在各页面散落 UA 正则。
 * ============================================================ */
import { tr } from '../../core/i18n';
import { getDesktopClient } from '../../utils/client';

/** 客户端仓库地址（桌面端发布页） */
const CLIENT_REPO = 'https://github.com/CircleChat-Team/CircleChat-Client/';

// 页面加载时判定一次即可：UA 在生命周期内不会变
const show = getDesktopClient() === null;
</script>

<template>
  <a
    v-if="show"
    class="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-fill px-3 py-2 text-xs text-muted transition-colors hover:text-primary"
    :href="CLIENT_REPO"
    target="_blank"
    rel="noopener noreferrer"
  >
    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3v10.6l3.3-3.3 1.4 1.4-5.7 5.7-5.7-5.7 1.4-1.4L11 13.6V3h1zM5 19h14v2H5v-2z" />
    </svg>
    <span>{{ tr('common.downloadClient') }}</span>
  </a>
</template>
