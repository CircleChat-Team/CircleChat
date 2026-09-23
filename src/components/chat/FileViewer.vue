<script setup lang="ts">
/* ============================================================
 * 文件查看器：预览 / 文本 / Hex / 图片 / 音频 / 视频
 *
 * 预览（SVG / HTML / Markdown）走 core/preview.ts：内容**只在沙箱 iframe 里渲染**
 * （HTML/MD）或**清理后当图片渲染**（SVG），本站 DOM 不接触这些内容。
 *
 * 判定**一律读文件头**（不看后缀）：
 *   媒体（图片/音频/视频）→ 交给 <img>/<audio>/<video> 自己流式加载，多大都能看
 *   其余二进制 → 三列 hex 视图（偏移 | 十六进制 | ASCII）
 *   文本 → 行号 + 内容（读内容推语言，认得出才高亮，认不出就是纯文本）
 *
 * 不卡死靠两点：
 *   1. 只读文件头 4KB 判类型，不为「认类型」把几十 MB 视频读进内存
 *   2. 文本与 hex 都只渲染可视区的行（虚拟滚动），2MB/十几万行也只挂几十个节点
 *      —— 代价是**大文本不能自动换行**（换行会让行高不定，虚拟滚动没法算）
 * ============================================================ */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { asset } from '../../core/api';
import { fmtSize } from '../../core/format';
import { tr } from '../../core/i18n';
import { useOverlay } from '../../core/useOverlay';
import { theme } from '../../core/theme';
import {
  buildHtmlDoc,
  buildMarkdownDoc,
  detectPreview,
  previewLimitFor,
  renderMarkdown,
  sanitizeSvg,
  type PreviewKind
} from '../../core/preview';
import {
  MAX_VIEW_BYTES,
  byteChar,
  byteHex,
  canView,
  decodeBytes,
  detectLanguage,
  hexOffset,
  hexRowCount,
  isPrintableByte,
  plainTextLines,
  rowWindow,
  shouldHighlight,
  sniffKind,
  sniffMedia,
  splitHtmlLines,
  type FileViewTarget,
  type MediaKind
} from '../../core/fileview';

type Phase = 'loading' | 'text' | 'hex' | 'too-large' | 'error' | MediaKind;

/** 要查看的文件；为 null 即关闭 */
const view = defineModel<FileViewTarget | null>({ default: null });
const box = ref<HTMLElement | null>(null);
const phase = ref<Phase>('loading');
const text = ref('');
const lang = ref<string | null>(null);
const highlighted = ref(false);
/** 内容字节数（高亮闸门按字节算，用它判断「是不是因为太大才没高亮」） */
const byteLen = ref(0);
const wrap = ref(true);
/** 渲染预览（SVG / HTML / Markdown）；null = 这个文件没有预览形态 */
const previewKind = ref<PreviewKind | null>(null);
/** 预览 or 源码（两者都可用时由用户切） */
const viewMode = ref<'preview' | 'text'>('text');
/** HTML / Markdown 的沙箱文档（srcdoc） */
const previewDoc = ref('');
/** SVG 清理后转成图片：用 blob URL，不落 DOM、也不走站点同源文档 */
const svgUrl = ref('');
/** SVG 解析/清理失败 → 提示改看源码，而不是留一片空白 */
const svgBroken = ref(false);
/**
 * 这个文件**能**预览、但超过了该类型的体积上限。
 * 以前的表现是「预览按钮直接不出现」，用户只能猜是限制还是 bug —— 现在按钮置灰并写明原因。
 */
const previewTooLarge = ref(false);
/** 媒体预览失败（服务端没按媒体类型下发、或浏览器不支持该编码） */
const mediaFailed = ref(false);

const url = computed(() => (view.value ? asset(view.value.url) : ''));

function close(): void {
  view.value = null;
}

// ---------- 虚拟滚动共用状态 ----------
/** 行高，必须与 CSS 的 --row-h 一致 */
const ROW_H = 22;
/** 可视区上下各多渲染几行 */
const BUFFER_ROWS = 6;
/** 文本行数超过它才虚拟滚动（不多时整篇渲染，换行也照旧可用） */
const TEXT_VIRTUAL_LINES = 2000;

const paneScroll = ref<HTMLElement | null>(null);
const paneTop = ref(0);
const paneH = ref(600);

function syncViewport(): void {
  const el = paneScroll.value;
  if (!el) return;
  paneTop.value = el.scrollTop;
  paneH.value = el.clientHeight || paneH.value;
}

function onWindowResize(): void {
  if (phase.value === 'text' || phase.value === 'hex') syncViewport();
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize);
  revokeSvg(); // 关窗/切页面时把 SVG 的 blob URL 回收掉
});

// 进入有滚动条的视图后量一次可视区（挂载前拿不到高度）
watch(phase, (p) => {
  if (p !== 'text' && p !== 'hex') return;
  void nextTick(() => {
    if (paneScroll.value) paneScroll.value.scrollTop = 0;
    syncViewport();
  });
});

// ---------- 文本 ----------

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

/** 逐行 HTML：高亮成功就按行切开（hljs 的标签会跨行，切的时候得带着标签栈），否则转义纯文本 */
const lines = computed<string[]>(() => {
  const t = text.value;
  const l = lang.value;
  const h = hljs.value;
  if (highlighted.value && l && h && h.getLanguage(l)) {
    try {
      return splitHtmlLines(h.highlight(t, { language: l, ignoreIllegals: true }).value);
    } catch (e) {
      /* 高亮失败就退回纯文本 */
    }
  }
  return plainTextLines(t);
});

const totalLines = computed(() => lines.value.length);
const virtualText = computed(() => totalLines.value > TEXT_VIRTUAL_LINES);
const txWin = computed(() =>
  virtualText.value
    ? rowWindow(totalLines.value, paneTop.value, paneH.value, ROW_H, BUFFER_ROWS)
    : { first: 0, last: totalLines.value }
);
const txRows = computed(() => {
  const all = lines.value;
  const w = txWin.value;
  const out: { no: number; html: string }[] = [];
  for (let i = w.first; i < w.last; i++) out.push({ no: i + 1, html: all[i] === undefined ? '' : all[i] });
  return out;
});
/** 行号列宽度按最大行号算 */
const noWidth = computed(() => Math.max(3, String(totalLines.value).length) + 'ch');

/** 超限时给人看的说明（带上该类型的上限） */
const previewLimitText = computed(() =>
  tr('fileview.previewTooLarge', { size: fmtSize(previewKind.value ? previewLimitFor(previewKind.value) : 0) })
);

/** 顶部标签：媒体/hex/预览类型/纯文本/语言名 */
const tag = computed(() => {
  if (phase.value === 'text' && previewKind.value && viewMode.value === 'preview') {
    return previewKind.value === 'markdown' ? 'Markdown' : previewKind.value.toUpperCase();
  }
  if (phase.value === 'hex') return tr('fileview.hex');
  if (phase.value === 'image') return tr('fileview.image');
  if (phase.value === 'audio') return tr('fileview.audio');
  if (phase.value === 'video') return tr('fileview.video');
  if (!lang.value || !highlighted.value) return tr('fileview.plain');
  return lang.value;
});

/** 明明认得语言、却没高亮的说明（体积或超长行闸门），否则用户只看到「纯文本」两个字 */
const tagTitle = computed(() => {
  if (phase.value !== 'text' || !lang.value || highlighted.value) return '';
  if (shouldHighlight(text.value, byteLen.value)) return '';
  return tr('fileview.noHighlight');
});

// ---------- Hex ----------

const hexBytes = shallowRef<Uint8Array | null>(null);
const perLine = ref(16); // 每行字节数，16 / 8 可切换
/** 鼠标划过的字节 */
const hxHover = ref<{ row: number; col: number } | null>(null);
/** 点击固定的字节（光标） */
const hxPick = ref<{ row: number; col: number } | null>(null);
/** 当前聚焦的字节：划过的优先，其次是点住的 */
const hxCur = computed(() => hxHover.value || hxPick.value);

interface HexCell {
  i: number;
  v: number | null;
}
interface HexRowView {
  row: number;
  offset: number;
  cells: HexCell[];
}

const hexRows = computed(() => hexRowCount(hexBytes.value ? hexBytes.value.length : 0, perLine.value));
const hexWin = computed(() => rowWindow(hexRows.value, paneTop.value, paneH.value, ROW_H, BUFFER_ROWS));

const hexView = computed<HexRowView[]>(() => {
  const buf = hexBytes.value;
  if (!buf) return [];
  const per = perLine.value;
  const out: HexRowView[] = [];
  for (let r = hexWin.value.first; r < hexWin.value.last; r++) {
    const base = r * per;
    const cells: HexCell[] = [];
    for (let i = 0; i < per; i++) {
      const p = base + i;
      cells.push({ i, v: p < buf.length ? buf[p] : null });
    }
    out.push({ row: r, offset: base, cells });
  }
  return out;
});

/** 单元格文本：两位十六进制 + 一个空格；补位处留三个空格保持列对齐 */
function cellText(v: number | null): string {
  return v === null ? '   ' : byteHex(v) + ' ';
}

function isCur(r: HexRowView, i: number): boolean {
  const c = hxCur.value;
  return !!c && c.row === r.row && c.col === i;
}

/** 底部状态栏：指到字节就报它，否则报总量 */
const hexInfo = computed(() => {
  const buf = hexBytes.value;
  if (!buf) return '';
  const c = hxCur.value;
  if (c) {
    const p = c.row * perLine.value + c.col;
    if (p < buf.length) {
      const b = buf[p];
      return tr('fileview.hexAt', {
        offset: '0x' + hexOffset(p),
        hex: '0x' + byteHex(b),
        dec: String(b),
        char: byteChar(b)
      });
    }
  }
  return tr('fileview.hexTotal', { bytes: buf.length, per: perLine.value, rows: hexRows.value });
});

/** 切每行字节数：按「当前行首字节」换算滚动位置，别让视图跳回开头 */
function togglePerLine(): void {
  const el = paneScroll.value;
  const topByte = Math.floor(paneTop.value / ROW_H) * perLine.value;
  const next = perLine.value === 16 ? 8 : 16;
  perLine.value = next;
  hxHover.value = null;
  hxPick.value = null;
  void nextTick(() => {
    if (!el) return;
    el.scrollTop = Math.floor(topByte / next) * ROW_H;
    syncViewport();
  });
}

// ---------- 加载 ----------

/**
 * 只读文件头：够判类型就行。
 * 流式读取、读完立刻 cancel —— 服务端只对媒体类型支持 Range，其它类型会照常发全量响应，
 * 不 cancel 的话「判个类型」就把整个文件下下来了。
 */
async function fetchHead(u: string, bytes = 4096): Promise<Uint8Array> {
  const ctl = new AbortController();
  const res = await fetch(u, {
    credentials: 'same-origin',
    signal: ctl.signal,
    headers: { Range: 'bytes=0-' + (bytes - 1) }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const reader = res.body ? res.body.getReader() : null;
  if (!reader) {
    const all = new Uint8Array(await res.arrayBuffer());
    return all.subarray(0, Math.min(all.length, bytes));
  }
  const chunks: Uint8Array[] = [];
  let got = 0;
  while (got < bytes) {
    const step = await reader.read();
    if (step.done) break;
    if (step.value) {
      chunks.push(step.value);
      got += step.value.length;
    }
  }
  try {
    await reader.cancel();
  } catch (e) {
    /* 已经读够了，取消失败无所谓 */
  }
  const out = new Uint8Array(Math.min(got, bytes));
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    out.set(c.subarray(0, out.length - off), off);
    off += c.length;
  }
  return out;
}

/**
 * 生成预览内容。
 * - HTML / Markdown：拼一个带 CSP 的文档字符串，交给 iframe 的 srcdoc（不生成 DOM）
 * - SVG：清理后转成 blob URL，用 <img> 渲染（图片上下文里 SVG 不执行脚本）
 */
/**
 * 把围栏代码块交给 hljs 上色。
 * 输入是我们自己 renderMarkdown 产出的 HTML（正文已转义），所以：
 *   - textContent 取回的是**原文**，不会把标签当 HTML 读；
 *   - hljs 的输出（.value）自己会转义，写回 innerHTML 是安全的；
 *   - 就算哪一步漏了，渲染它的也是沙箱 iframe（无脚本 + CSP default-src 'none'）。
 */
async function highlightFences(html: string): Promise<string> {
  if (html.indexOf('<pre data-lang=') === -1) return html;
  const h = await ensureHljs();
  if (!h) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const pre of Array.from(doc.querySelectorAll('pre[data-lang]'))) {
    const code = pre.querySelector('code');
    const l = String(pre.getAttribute('data-lang') || '').toLowerCase();
    if (!code || !l || !h.getLanguage(l)) continue;
    try {
      code.innerHTML = h.highlight(code.textContent || '', { language: l, ignoreIllegals: true }).value;
      code.classList.add('hljs');
      pre.classList.add('hljs');
    } catch (e) {
      /* 高亮失败就保持纯文本，不影响预览 */
    }
  }
  return doc.body.innerHTML;
}

async function buildPreview(): Promise<void> {
  const kind = previewKind.value;
  if (kind === 'svg') {
    const res = sanitizeSvg(text.value);
    if (!res) {
      svgBroken.value = true;
      previewDoc.value = '';
      return;
    }
    svgBroken.value = false;
    revokeSvg();
    try {
      svgUrl.value = URL.createObjectURL(new Blob([res.svg], { type: 'image/svg+xml' }));
    } catch (e) {
      svgBroken.value = true;
    }
    return;
  }
  // base 指向文件所在目录，文档里的相对路径按文件自身位置解析
  const dir = url.value.replace(/[^/]*$/, '');
  const opts = { base: dir, theme: theme.value === 'dark' ? ('dark' as const) : ('light' as const) };
  if (kind === 'html') {
    previewDoc.value = buildHtmlDoc(text.value, opts);
    return;
  }
  // markdown：先渲染，再把围栏代码块交给 hljs 上色，最后套进沙箱文档
  const body = await highlightFences(renderMarkdown(text.value));
  if (previewKind.value !== 'markdown') return; // 等 hljs 期间用户换了文件/关了窗
  previewDoc.value = buildMarkdownDoc(body, opts);
}

/** 回收 SVG 的 blob URL（每次换文件/关窗都要做，否则一直占内存） */
function revokeSvg(): void {
  if (!svgUrl.value) return;
  try {
    URL.revokeObjectURL(svgUrl.value);
  } catch (e) {
    /* 忽略 */
  }
  svgUrl.value = '';
}

/** 整读（文本 / hex 需要完整内容；调用前已用文件头把媒体挡掉） */
async function fetchAll(u: string): Promise<Uint8Array> {
  const res = await fetch(u, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return new Uint8Array(await res.arrayBuffer());
}

async function load(): Promise<void> {
  const v = view.value;
  if (!v) return;
  phase.value = 'loading';
  text.value = '';
  hexBytes.value = null;
  lang.value = null;
  highlighted.value = false;
  wrap.value = true;
  mediaFailed.value = false;
  perLine.value = 16;
  hxHover.value = null;
  hxPick.value = null;
  previewKind.value = null;
  previewDoc.value = '';
  svgBroken.value = false;
  previewTooLarge.value = false;
  revokeSvg();
  viewMode.value = 'text';
  try {
    // 1) 先看文件头：媒体（图片/音频/视频）交给标签自己流式加载，多大的文件都能看，
    //    也不必把内容读进内存
    const head = await fetchHead(url.value);
    if (view.value !== v) return; // 等待期间用户关了或换了文件
    const media = sniffMedia(head);
    if (media) {
      phase.value = media;
      return;
    }
    // 2) 文本 / hex 需要完整内容；超过 2MB 不给看（先按元数据拦一道，省一次下载）
    if (!canView(v.size)) {
      phase.value = 'too-large';
      return;
    }
    const buf = await fetchAll(url.value);
    if (view.value !== v) return;
    if (buf.length > MAX_VIEW_BYTES) {
      phase.value = 'too-large';
      return;
    }
    if (sniffKind(buf.subarray(0, 8192)) === 'binary') {
      hexBytes.value = buf;
      phase.value = 'hex';
      return;
    }
    text.value = decodeBytes(buf);
    byteLen.value = buf.length;
    const l = detectLanguage(text.value);
    lang.value = l;
    phase.value = 'text'; // 先按纯文本显示，高亮器到位后自动升级，不用一直等
    // 能渲染预览的（SVG / HTML / Markdown）默认给预览。
    // 类型判定与体积上限分开：超过了就只给文本/Hex，并在工具栏里说明原因
    previewKind.value = detectPreview(text.value);
    if (previewKind.value) {
      const limit = previewLimitFor(previewKind.value);
      previewTooLarge.value = buf.length > limit;
      if (!previewTooLarge.value) {
        void buildPreview();
        viewMode.value = 'preview';
      }
      // 预览类型同时确定了「源码视图按什么语言高亮」：
      //   markdown：detectLanguage 会被代码块里的 `const x = 1` / `def f():` 带偏，
      //             也可能压根认不出来（只有标题 + 列表的文档）
      //   html：detectLanguage 只认 `<!DOCTYPE html>` / `<html>` 开头，
      //         没有这些的片段会被判成「认不出来」→ 源码就成了纯文本
      if (previewKind.value === 'markdown') lang.value = 'markdown';
      else if (previewKind.value === 'html' && !lang.value) lang.value = 'xml';
    }
    // 高亮条件：有语言（**含上面按预览类型补的**）+ 语言在 hljs 的 common 打包里 +
    // 体积/单行长度没过闸。必须用 lang.value：用原始推断结果的话，
    // 上面刚补好的语言会被这条闸门拦掉，源码依旧是纯文本
    const hl = lang.value;
    if (hl && shouldHighlight(text.value, buf.length)) {
      const h = await ensureHljs();
      if (view.value !== v) return;
      if (h && h.getLanguage(hl)) highlighted.value = true;
    }
  } catch (e) {
    phase.value = 'error';
  }
}

watch(view, (v) => {
  if (v) {
    void load();
    return;
  }
  revokeSvg(); // 关窗
}, { immediate: true });

// 主题变了要重建文档：markdown 预览的配色是写进文档里的
watch(theme, () => {
  if (previewKind.value && previewKind.value !== 'svg' && previewDoc.value) void buildPreview();
});

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
        <span
          v-if="phase !== 'loading' && phase !== 'error' && phase !== 'too-large'"
          class="fileview-tag"
          :title="tagTitle"
        >{{ tag }}</span>
        <span class="fileview-size">{{ fmtSize(view.size) }}</span>
        <div class="fileview-actions">
          <!-- 能渲染的（SVG / HTML / Markdown）：预览与源码之间切换 -->
          <template v-if="phase === 'text' && previewKind">
            <button
              type="button"
              class="fv-btn"
              :class="{ on: viewMode === 'preview' }"
              :disabled="previewTooLarge"
              :title="previewTooLarge ? previewLimitText : ''"
              @click="viewMode = 'preview'"
            >{{ tr('fileview.previewMode') }}</button>
            <button
              type="button"
              class="fv-btn"
              :class="{ on: viewMode === 'text' }"
              @click="viewMode = 'text'"
            >{{ tr('fileview.source') }}</button>
            <!-- 为什么没有预览：把限制写出来，别让人以为是 bug -->
            <span v-if="previewTooLarge" class="fv-note">{{ previewLimitText }}</span>
          </template>
          <!-- 大文本是虚拟滚动（固定行高），换行会让行高不定，所以只在整篇渲染时给 -->
          <button
            v-if="phase === 'text' && !virtualText && viewMode === 'text'"
            type="button"
            class="fv-btn"
            :class="{ on: wrap }"
            @click="wrap = !wrap"
          >{{ tr('fileview.wrap') }}</button>
          <!-- hex 是固定列网格，换行会打乱对齐；窄屏真正有用的是每行放几个字节 -->
          <button
            v-else-if="phase === 'hex'"
            type="button"
            class="fv-btn"
            @click="togglePerLine"
          >{{ tr('fileview.bytesPerRow', { n: perLine }) }}</button>
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

        <!-- 图片 / 视频 / 音频：不读内容，交给标签自己流式加载 -->
        <div v-else-if="phase === 'image'" class="media-wrap">
          <img v-if="!mediaFailed" :src="url" :alt="view.name || ''" @error="mediaFailed = true" />
          <p v-else class="media-fail">{{ tr('fileview.previewFailed') }}</p>
        </div>
        <div v-else-if="phase === 'video'" class="media-wrap">
          <video v-if="!mediaFailed" :src="url" controls @error="mediaFailed = true"></video>
          <p v-else class="media-fail">{{ tr('fileview.previewFailed') }}</p>
        </div>
        <div v-else-if="phase === 'audio'" class="media-wrap media-audio">
          <template v-if="!mediaFailed">
            <audio :src="url" controls @error="mediaFailed = true"></audio>
            <p class="media-note">{{ view.name }}</p>
          </template>
          <p v-else class="media-fail">{{ tr('fileview.previewFailed') }}</p>
        </div>

        <!-- Hex：三列（偏移 | 十六进制 | 文本），逐字节单元格 + 只渲染可视区 -->
        <div v-else-if="phase === 'hex'" class="hx-wrap">
          <div ref="paneScroll" class="hx-scroll" @scroll="syncViewport" @mouseleave="hxHover = null">
            <!-- 列头放在滚动容器里做 sticky：横向滚动时跟着列一起走 -->
            <div class="hx-head">
              <span class="hx-off">{{ tr('fileview.colOffset') }}</span>
              <span class="hx-bytes">{{ tr('fileview.colHex') }}</span>
              <span class="hx-txt">{{ tr('fileview.colText') }}</span>
            </div>

            <div class="hx-spacer" :style="{ height: hexRows * ROW_H + 'px' }">
              <div class="hx-rows" :style="{ transform: 'translateY(' + hexWin.first * ROW_H + 'px)' }">
                <div
                  v-for="r in hexView"
                  :key="r.offset"
                  class="hx-row"
                  :class="{ alt: r.row % 2 === 1 }"
                  @mouseleave="hxHover = null"
                >
                  <span class="hx-off">{{ hexOffset(r.offset) }}</span>
                  <span class="hx-bytes">
                    <i
                      v-for="c in r.cells"
                      :key="'b' + c.i"
                      class="hx-b"
                      :class="{ dim: c.v === null, gap: perLine === 16 && c.i === 7, on: isCur(r, c.i) }"
                      @mouseenter="hxHover = { row: r.row, col: c.i }"
                      @click="hxPick = { row: r.row, col: c.i }"
                    >{{ cellText(c.v) }}</i>
                  </span>
                  <span class="hx-txt">
                    <i
                      v-for="c in r.cells"
                      :key="'c' + c.i"
                      class="hx-c"
                      :class="{ dim: c.v === null || !isPrintableByte(c.v), on: isCur(r, c.i) }"
                      @mouseenter="hxHover = { row: r.row, col: c.i }"
                      @click="hxPick = { row: r.row, col: c.i }"
                    >{{ c.v === null ? ' ' : byteChar(c.v) }}</i>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="hx-status">{{ hexInfo }}</div>
        </div>

        <!-- 渲染预览：内容只活在沙箱 iframe / 图片里，不与本站 DOM 同源 -->
        <div
          v-else-if="phase === 'text' && previewKind && viewMode === 'preview'"
          class="pv-wrap"
          :class="{ 'pv-wrap-frame': previewKind !== 'svg' }"
        >
          <p v-if="svgBroken" class="fileview-msg">
            {{ tr('fileview.svgBroken') }}
            <button type="button" class="fv-btn" @click="viewMode = 'text'">{{ tr('fileview.source') }}</button>
          </p>
          <!-- SVG：清理后当图片渲染（图片上下文里不执行脚本、不取外部资源） -->
          <img
            v-else-if="previewKind === 'svg'"
            class="pv-svg"
            :src="svgUrl"
            :alt="view.name || ''"
            @error="svgBroken = true"
          >
          <!-- HTML / Markdown：sandbox 里没有 allow-scripts / allow-same-origin，
               文档内另有 CSP default-src 'none'，两层都挡脚本与外部请求。
               ⚠️ 必须等 previewDoc 就绪后再渲染 iframe：Markdown 的文档要等 hljs
               上色（异步），如果先建一个空 srcdoc 的 iframe 再更新属性，
               Chromium 不会重新解析，预览会一直是一张白纸（实测踩过）。 -->
          <iframe
            v-else-if="previewDoc"
            class="pv-frame"
            sandbox=""
            referrerpolicy="no-referrer"
            :srcdoc="previewDoc"
            :title="view.name || 'preview'"
          ></iframe>
          <p v-else class="fileview-msg">{{ tr('fileview.loading') }}</p>
        </div>

        <!-- 文本：行号 + 内容；行数多时只渲染可视区（虚拟滚动） -->
        <div v-else class="tx-wrap" :style="{ '--no-w': noWidth }">
          <div ref="paneScroll" class="tx-scroll" @scroll="syncViewport">
            <div
              class="tx-spacer"
              :class="{ fixed: virtualText, 'wrap-on': wrap && !virtualText }"
              :style="virtualText ? { height: totalLines * ROW_H + 'px' } : {}"
            >
              <div
                class="tx-rows"
                :style="virtualText ? { transform: 'translateY(' + txWin.first * ROW_H + 'px)' } : {}"
              >
                <div
                  v-for="l in txRows"
                  :key="l.no"
                  class="tx-row"
                  :class="{ wrap: wrap && !virtualText, alt: (l.no - 1) % 2 === 1 }"
                >
                  <span class="tx-no">{{ l.no }}</span>
                  <span class="tx-line" v-html="l.html"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
