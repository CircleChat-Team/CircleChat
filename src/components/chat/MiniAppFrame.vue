<script setup lang="ts">
/* ============================================================
 * 小程序运行容器
 * iframe 只给 allow-scripts：不透明源、拿不到 Cookie、碰不到宿主 DOM。
 * 上下文与令牌由宿主在握手时下发，数据读写走 postMessage 桥（或令牌直连）。
 * ============================================================ */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { asset } from '../../core/api';
import { tr } from '../../core/i18n';
import { useOverlay } from '../../core/useOverlay';
import { attachMiniBridge, closeMiniApp, miniState } from '../../core/mini';

const frameEl = ref<HTMLIFrameElement | null>(null);
const rootEl = ref<HTMLElement | null>(null);
/** 加载失败（脚本报错 / 地址不可达）时的兜底 */
const failed = ref(false);
/** 每次「重新加载」换一次 key，强制 iframe 重建 */
const frameKey = ref(0);
/** 握手超时：小程序没引入 SDK 也能继续用，只做弱提示 */
const noHandshake = ref(false);
let handshakeTimer: number | undefined;

const run = computed(() => miniState.running);

/**
 * 小程序页面可能托管在任意站点（官方源用的是 GitHub raw，它把 .html 也发成 text/plain，
 * 直接当 iframe 地址浏览器不会渲染）。所以这里先把页面文本取回来，用 srcdoc 渲染，
 * 并顺手把平台自己的 SDK 注入进去——否则小程序不知道该去哪儿加载 SDK。
 * 取不回（无 CORS / 网络问题）就退回直接给 iframe src。
 */
const frameDoc = ref('');
const frameSrc = ref('');

function injectSdk(html: string): string {
  // 注意：SFC 里不能出现完整的 script 结束标签（会提前闭合本块），拆开拼
  const tag = '<script src="' + location.origin + '/mini-sdk.js"><' + '/script>';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + '<head>' + tag + '</head>');
  return tag + html;
}

async function loadEntry(url: string): Promise<void> {
  frameDoc.value = '';
  frameSrc.value = '';
  try {
    const r = await fetch(url, { credentials: 'omit' });
    const text = await r.text();
    if (!text) throw new Error('empty');
    frameDoc.value = injectSdk(text);
  } catch {
    frameSrc.value = url;
  }
}

const boxStyle = computed(() => {
  const r = run.value;
  if (!r) return {};
  return {
    width: 'min(' + r.width + 'px, calc(100vw - 32px))',
    height: 'min(' + r.height + 'px, calc(100vh - 96px))'
  };
});

function permText(p: string): string {
  return tr('mini.perm.' + p);
}

function reload(): void {
  failed.value = false;
  frameKey.value++;
  if (run.value) void loadEntry(asset(run.value.entry));
}

// 换小程序 / 换作用域时重置状态
watch(
  () => (miniState.running ? miniState.running.appId + '|' + miniState.running.scope + '|' + miniState.running.scopeId : ''),
  (key) => {
    failed.value = false;
    noHandshake.value = false;
    clearTimeout(handshakeTimer);
    if (!key) return;
    void loadEntry(asset(run.value ? run.value.entry : ''));
    // 4 秒内没握手成功就提示（不影响继续使用）
    handshakeTimer = window.setTimeout(() => {
      if (miniState.running && !miniState.running.invoked && miniState.running.context) noHandshake.value = true;
    }, 4000);
  }
);

useOverlay({
  isOpen: () => !!miniState.running,
  onClose: closeMiniApp,
  container: () => rootEl.value
});

let detach: (() => void) | null = null;
onMounted(() => {
  detach = attachMiniBridge(() => frameEl.value);
});
onBeforeUnmount(() => {
  if (detach) detach();
  clearTimeout(handshakeTimer);
});
</script>

<template>
  <div
    v-if="run"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
    @click.self="closeMiniApp"
  >
    <div
      ref="rootEl"
      class="relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel text-ink shadow-2xl"
      :style="boxStyle"
    >
      <header class="flex items-center gap-2 border-b border-line px-3 py-2">
        <img v-if="run.icon" :src="asset(run.icon)" alt="" class="h-6 w-6 rounded-md object-cover" />
        <span v-else class="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-[11px] font-semibold">
          {{ run.name.slice(0, 1) }}
        </span>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold leading-tight">{{ run.name }}</div>
          <div class="truncate text-[11px] text-faint">
            {{ run.scope === 'group' ? tr('mini.scope.group') : tr('mini.scope.user') }}
            <template v-if="run.command"> · #{{ run.command }}</template>
          </div>
        </div>
        <span
          v-if="run.permissions.length"
          class="hidden shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-faint sm:inline"
          :title="run.permissions.map(permText).join('、')"
        >
          {{ run.permissions.length }} {{ tr('mini.perms.count') }}
        </span>
        <button
          type="button"
          class="shrink-0 rounded-md px-2 py-1 text-xs text-faint transition-colors hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
          :title="tr('mini.running.reload')"
          @click="reload"
        >{{ tr('mini.running.reload') }}</button>
        <button
          type="button"
          class="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-faint transition-colors hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
          :title="tr('common.close')"
          :aria-label="tr('common.close')"
          @click="closeMiniApp"
        >×</button>
      </header>

      <div class="relative min-h-0 flex-1 bg-bg">
        <div v-if="run.loading" class="absolute inset-0 flex items-center justify-center text-sm text-faint">
          {{ tr('common.loading') }}
        </div>

        <div v-else-if="run.error" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p class="text-sm text-danger">{{ tr(run.error) }}</p>
          <button type="button" class="rounded-lg border border-line px-3 py-1.5 text-sm" @click="closeMiniApp">
            {{ tr('common.close') }}
          </button>
        </div>

        <div v-else-if="failed" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p class="text-sm text-danger">{{ tr('mini.running.failed') }}</p>
          <div class="flex gap-2">
            <button type="button" class="rounded-lg border border-line px-3 py-1.5 text-sm" @click="reload">
              {{ tr('mini.running.retry') }}
            </button>
            <button type="button" class="rounded-lg border border-line px-3 py-1.5 text-sm text-faint" @click="closeMiniApp">
              {{ tr('common.close') }}
            </button>
          </div>
        </div>

        <div v-else-if="!frameDoc && !frameSrc" class="flex h-full items-center justify-center text-sm text-faint">
          {{ tr('common.loading') }}
        </div>

        <iframe
          v-else
          :key="frameKey"
          ref="frameEl"
          class="h-full w-full border-0"
          :srcdoc="frameDoc || undefined"
          :src="frameSrc || undefined"
          sandbox="allow-scripts"
          :title="run.name"
          @error="failed = true"
        ></iframe>

        <p
          v-if="noHandshake && !run.loading && !run.error"
          class="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] text-white"
        >
          {{ tr('mini.running.noSdk') }}
        </p>
      </div>
    </div>
  </div>
</template>
