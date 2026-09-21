<script setup lang="ts">
/* ============================================================
 * 文件查看器：文本 / Hex 两种视图
 *
 * - 文本：行号 + 内容；**读文件头推断语言**，认得出就高亮，认不出就是纯文本
 *   （不按后缀名判断：后缀可以乱改，内容不会骗人）
 * - 二进制：经典 hex dump，每行「偏移地址 + 16 字节 + ASCII」
 * - 超过 2MB 不给看，只提供下载（两种视图同样限制）
 * - 顶部有「自动换行」开关：文本默认开，Hex 默认关（换行会打乱列对齐）
 * - 单行超过 5000 字符、或文件超过 512KB 时不做高亮（高亮器会阻塞界面）
 *
 * 刻意不依赖聊天页的状态：`v-model` 传进来要看的文件即可，
 * 聊天页、群管理页、管理面板都能挂（那两页是独立的 Vue 应用，状态层不通）。
 * ============================================================ */
import { computed, ref, shallowRef, watch } from 'vue';
import { asset } from '../../core/api';
import { fmtSize } from '../../core/format';
import { tr } from '../../core/i18n';
import { useOverlay } from '../../core/useOverlay';
import {
  MAX_VIEW_BYTES,
  canView,
  decodeBytes,
  detectLanguage,
  hexDump,
  shouldHighlight,
  sniffKind,
  type FileViewTarget
} from '../../core/fileview';

type Phase = 'loading' | 'text' | 'hex' | 'too-large' | 'error';

/** 要查看的文件；为 null 即关闭 */
const view = defineModel<FileViewTarget | null>({ default: null });
const box = ref<HTMLElement | null>(null);
const phase = ref<Phase>('loading');
const text = ref('');
const hexText = ref('');
const lang = ref<string | null>(null);
const highlighted = ref(false);
const wrap = ref(true);

const url = computed(() => (view.value ? asset(view.value.url) : ''));

function close(): void {
  view.value = null;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 高亮器：按需动态加载（hljs 一百多 KB，群页/管理页不该为了打开一次文件就全量下载） */
interface HljsLike {
  getLanguage: (name: string) => unknown;
  highlight: (code: string, opts: { language: string; ignoreIllegals?: boolean }) => { value: string };
}
const hljs = shallowRef<HljsLike | null>(null); // shallowRef：别让 Vue 深度代理 hljs 那一大坨对象
let hljsPromise: Promise<HljsLike | null> | null = null;

function ensureHljs(): Promise<HljsLike | null> {
  if (hljs.value) return Promise.resolve(hljs.value);
  if (!hljsPromise) {
    hljsPromise = import('highlight.js/lib/common')
      .then((m) => (m.default as unknown as HljsLike))
      .catch(() => null);
  }
  return hljsPromise.then((h) => {
    if (h) hljs.value = h;
    return h;
  });
}

/** 高亮后的 HTML；不高亮时退回转义纯文本（v-html 的内容始终是安全的） */
const codeHtml = computed(() => {
  const t = text.value;
  const l = lang.value;
  const h = hljs.value;
  if (!l || !h || !h.getLanguage(l)) return escapeHtml(t);
  try {
    return h.highlight(t, { language: l, ignoreIllegals: true }).value;
  } catch (e) {
    return escapeHtml(t);
  }
});

/** 行号列（按行数生成 1..N） */
const gutter = computed(() => {
  const n = text.value.split('\n').length;
  let s = '';
  for (let i = 1; i <= n; i++) s += i + '\n';
  return s.replace(/\n$/, '');
});

/** 顶部标签：高亮时显示语言名；认不出语言、或因为太大/单行过长没高亮时显示「纯文本」 */
const tag = computed(() => {
  if (phase.value === 'hex') return tr('fileview.hex');
  if (!lang.value || !highlighted.value) return tr('fileview.plain');
  return lang.value;
});

async function load(): Promise<void> {
  const v = view.value;
  if (!v) return;
  phase.value = 'loading';
  text.value = '';
  hexText.value = '';
  lang.value = null;
  highlighted.value = false;
  wrap.value = true;
  // 先按消息里的体积拦一道，省掉一次没必要的下载
  if (!canView(v.size)) {
    phase.value = 'too-large';
    return;
  }
  try {
    const res = await fetch(url.value, { credentials: 'same-origin' });
    if (!res.ok) {
      phase.value = 'error';
      return;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    // 体积元数据可能不准（老消息没有 size），读到内容后再拦一道
    if (buf.length > MAX_VIEW_BYTES) {
      phase.value = 'too-large';
      return;
    }
    if (sniffKind(buf.subarray(0, 8192)) === 'binary') {
      hexText.value = hexDump(buf);
      phase.value = 'hex';
      wrap.value = false; // hex 默认不换行，保持列对齐
      return;
    }
    text.value = decodeBytes(buf);
    const l = detectLanguage(text.value);
    lang.value = l;
    phase.value = 'text'; // 先按纯文本显示，高亮器到位后自动升级，不用一直等
    // 高亮条件：认得出语言 + 语言在 hljs 的 common 打包里 + 体积/单行长度没过闸
    if (l && shouldHighlight(text.value, buf.length)) {
      const h = await ensureHljs();
      if (view.value !== v) return; // 等待期间用户关了或换了文件，别覆盖新内容
      if (h && h.getLanguage(l)) highlighted.value = true;
    }
  } catch (e) {
    phase.value = 'error';
  }
}

watch(view, (v) => {
  if (v) void load();
}, { immediate: true });

useOverlay({
  isOpen: () => !!view.value,
  onClose: () => close(),
  container: () => box.value
});
</script>

<template>
  <div v-if="view" class="fileview-mask" @click.self="close()">
    <div ref="box" class="fileview" role="dialog" tabindex="-1">
      <header class="fileview-head">
        <span class="fileview-name" :title="view.name || ''">{{ view.name }}</span>
        <span v-if="phase === 'text' || phase === 'hex'" class="fileview-tag">{{ tag }}</span>
        <span class="fileview-size">{{ fmtSize(view.size) }}</span>
        <div class="fileview-actions">
          <button
            v-if="phase === 'text' || phase === 'hex'"
            type="button"
            class="fv-btn"
            :class="{ on: wrap }"
            @click="wrap = !wrap"
          >{{ tr('fileview.wrap') }}</button>
          <a class="fv-btn" :href="url" :download="view.name || ''">{{ tr('fileview.download') }}</a>
          <button type="button" class="fv-btn" @click="close()">{{ tr('common.close') }}</button>
        </div>
      </header>

      <div class="fileview-body">
        <p v-if="phase === 'loading'" class="fileview-msg">{{ tr('fileview.loading') }}</p>

        <div v-else-if="phase === 'too-large'" class="fileview-msg">
          <p>{{ tr('fileview.tooLarge', { size: fmtSize(MAX_VIEW_BYTES) }) }}</p>
          <a class="fv-btn fv-btn-primary" :href="url" :download="view.name || ''">{{ tr('fileview.download') }}</a>
        </div>

        <p v-else-if="phase === 'error'" class="fileview-msg">{{ tr('common.loadFailed') }}</p>

        <pre v-else-if="phase === 'hex'" class="fileview-hex" :class="{ wrap }">{{ hexText }}</pre>

        <div v-else class="fileview-code">
          <pre class="fileview-gutter">{{ gutter }}</pre>
          <!-- 带 code-pre 类是为了沿用 style.css 里那套 hljs 配色（它挂在 .code-pre 下） -->
          <pre class="fileview-pre code-pre" :class="{ wrap }"><code v-html="codeHtml"></code></pre>
        </div>
      </div>
    </div>
  </div>
</template>
