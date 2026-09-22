<script setup lang="ts">
/* ============================================================
 * 文件查看器：文本 / Hex 两种视图
 *
 * - 文本：行号 + 内容；**读文件头推断语言**，认得出就高亮，认不出就是纯文本
 *   （不按后缀名判断：后缀可以乱改，内容不会骗人）
 * - 二进制：三列 hex 视图 —— 偏移地址 | 十六进制字节 | ASCII 文本。
 *   逐字节渲染成单元格（不是一坨文本），鼠标划过同时高亮对应的字节与字符，
 *   点击固定住光标，底部状态栏显示该字节的偏移 / 十六进制 / 十进制 / 字符。
 * - 超过 2MB 不给看，只提供下载（两种视图同样限制）
 * - 文本：单行超过 5000 字符、或文件超过 512KB 时不做高亮（高亮器会阻塞界面）
 * - Hex：2MB 有十几万行，**只渲染可视区的行**（虚拟滚动），否则 DOM 百万节点直接卡死
 *
 * 刻意不依赖聊天页的状态：`v-model` 传进来要看的文件即可，
 * 聊天页、群管理页、管理面板都能挂（那两页是独立 Vue 应用，状态层不通）。
 * ============================================================ */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { asset } from '../../core/api';
import { fmtSize } from '../../core/format';
import { tr } from '../../core/i18n';
import { useOverlay } from '../../core/useOverlay';
import {
  MAX_VIEW_BYTES,
  byteChar,
  byteHex,
  canView,
  decodeBytes,
  detectLanguage,
  hexOffset,
  hexRowCount,
  hexWindow,
  isPrintableByte,
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

// ---------- 文本：语法高亮 ----------

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

// ---------- Hex：三列网格 + 虚拟滚动 ----------

/** 行高，必须与 CSS 的 --hx-row-h 一致（虚拟滚动靠它换算） */
const ROW_H = 22;
/** 可视区上下各多渲染几行，快速滚动时不至于露白 */
const BUFFER_ROWS = 6;

const hexBytes = shallowRef<Uint8Array | null>(null);
const perLine = ref(16); // 每行字节数，16 / 8 可切换
const hexScroll = ref<HTMLElement | null>(null);
const hexTop = ref(0);
const hexViewH = ref(600);
/** 鼠标划过的字节 */
const hxHover = ref<{ row: number; col: number } | null>(null);
/** 点击固定的字节（光标） */
const hxPick = ref<{ row: number; col: number } | null>(null);
/** 当前聚焦的字节：划过的优先，其次是点住的 */
const hxCur = computed(() => hxHover.value || hxPick.value);

interface HexCell {
  /** 行内第几列 */
  i: number;
  /** 字节值；超出内容（最后一行补位）为 null */
  v: number | null;
}
interface HexRowView {
  /** 行号（不是字节偏移） */
  row: number;
  /** 行首字节偏移 */
  offset: number;
  cells: HexCell[];
}

const hexRows = computed(() => hexRowCount(hexBytes.value ? hexBytes.value.length : 0, perLine.value));
const hexPadHeight = computed(() => hexRows.value * ROW_H);
const hexWin = computed(() => hexWindow(hexRows.value, hexTop.value, hexViewH.value, ROW_H, BUFFER_ROWS));
const hexFirstRow = computed(() => hexWin.value.first);

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

function syncHexViewport(): void {
  const el = hexScroll.value;
  if (!el) return;
  hexTop.value = el.scrollTop;
  hexViewH.value = el.clientHeight || hexViewH.value;
}

/** 切每行字节数：按「当前行首字节」换算滚动位置，别让视图跳回开头 */
function togglePerLine(): void {
  const el = hexScroll.value;
  const topByte = Math.floor(hexTop.value / ROW_H) * perLine.value;
  const next = perLine.value === 16 ? 8 : 16;
  perLine.value = next;
  hxHover.value = null;
  hxPick.value = null;
  void nextTick(() => {
    if (!el) return;
    el.scrollTop = Math.floor(topByte / next) * ROW_H;
    syncHexViewport();
  });
}

function onWindowResize(): void {
  if (phase.value === 'hex') syncHexViewport();
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize);
});

// 进入 hex 视图后量一次可视区（挂载前拿不到高度）
watch(phase, (p) => {
  if (p !== 'hex') return;
  void nextTick(() => {
    if (hexScroll.value) hexScroll.value.scrollTop = 0;
    syncHexViewport();
  });
});

// ---------- 加载 ----------

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
  hexBytes.value = null;
  lang.value = null;
  highlighted.value = false;
  wrap.value = true;
  perLine.value = 16;
  hxHover.value = null;
  hxPick.value = null;
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
      hexBytes.value = buf;
      phase.value = 'hex';
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
            v-if="phase === 'text'"
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

        <!-- Hex：三列（偏移 | 十六进制 | 文本），逐字节单元格 + 只渲染可视区 -->
        <div v-else-if="phase === 'hex'" class="hx-wrap">
          <div
            ref="hexScroll"
            class="hx-scroll"
            @scroll="syncHexViewport"
            @mouseleave="hxHover = null"
          >
            <!-- 列头放在滚动容器里做 sticky：横向滚动时跟着列一起走 -->
            <div class="hx-head">
              <span class="hx-off">{{ tr('fileview.colOffset') }}</span>
              <span class="hx-bytes">{{ tr('fileview.colHex') }}</span>
              <span class="hx-txt">{{ tr('fileview.colText') }}</span>
            </div>

            <div class="hx-spacer" :style="{ height: hexPadHeight + 'px' }">
              <div class="hx-rows" :style="{ transform: 'translateY(' + hexFirstRow * ROW_H + 'px)' }">
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

        <div v-else class="fileview-code">
          <pre class="fileview-gutter">{{ gutter }}</pre>
          <!-- 带 code-pre 类是为了沿用 style.css 里那套 hljs 配色（它挂在 .code-pre 下） -->
          <pre class="fileview-pre code-pre" :class="{ wrap }"><code v-html="codeHtml"></code></pre>
        </div>
      </div>
    </div>
  </div>
</template>
