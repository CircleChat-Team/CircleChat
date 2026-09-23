/* ============================================================
 * 渲染预览（SVG / HTML / Markdown）—— 渲染全程不碰本站 DOM
 *
 * 为什么要这么小心：文件是**别人上传的**，里面可以放任何东西。预览等于把
 * 不受信任的内容交给浏览器渲染，所以这里用「渲染隔离 + 内容清理」两层：
 *
 *   1. HTML / Markdown → 只作为字符串塞进 `<iframe sandbox="" srcdoc>`：
 *      - 没有 allow-scripts        → 脚本一律不执行（哪怕清漏了 <script>）
 *      - 没有 allow-same-origin    → 不透明源：拿不到 cookie/localStorage、
 *                                    读不到父页面、也发不出带凭证的请求
 *      - 没有 allow-forms / popups / top-navigation → 表单、弹窗、跳顶层都失效
 *      文档里再插一层 CSP `default-src 'none'`（第二把锁：脚本与外部请求全禁），
 *      只放开内联样式与内联图片 —— 连 <img src="https://外部"> 都不会发出去，
 *      避免「打开预览就给人家的服务器报 IP」。
 *
 *   2. SVG 不做成文档，而是**清理后转成图片**（`<img src=blob:>`）：
 *      图片上下文中 SVG 处于 secure static mode —— 按规范不执行脚本、不加载外部
 *      资源；`sanitizeSvg()` 只是再上一道保险（去掉 script / foreignObject
 *      元素、on 开头的事件属性、以及 javascript: 开头的链接）。
 *
 * 本模块**没有任何一次 innerHTML 写入本站 DOM**：产出的都是字符串，交给
 * iframe 的 srcdoc / img 的 src。
 * ============================================================ */
import { detectLanguage } from './fileview';

/** 可渲染预览的类型 */
export type PreviewKind = 'svg' | 'html' | 'markdown';

/**
 * 预览的体积上限。
 * SVG / HTML 交给浏览器自己渲染（iframe / img），几 MB 也没问题，所以跟「可查看」
 * 上限保持一致；Markdown 走的是我们自己的逐行渲染器，太大要卡主线程，单独收严。
 */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
export const MAX_MD_PREVIEW_BYTES = 1024 * 1024;

/** 某个预览类型对应的体积上限 */
export function previewLimitFor(kind: PreviewKind): number {
  return kind === 'markdown' ? MAX_MD_PREVIEW_BYTES : MAX_PREVIEW_BYTES;
}

// ---------- 类型嗅探 ----------

/** 去掉开头的 BOM 与空白 */
function ltrim(s: string): string {
  return String(s || '').replace(/^\uFEFF/, '').trimStart();
}

/**
 * 跳过 XML 声明 / 注释 / DOCTYPE，返回「真正开始的那段标记」。
 * 预览判断必须跳过它们：`<?xml ...?><svg>` 和 `<!-- c --><svg>` 都还是 SVG。
 */
export function rootMarkup(text: string): string {
  let t = ltrim(text);
  for (let i = 0; i < 20; i++) {
    if (/^<\?[^>]*\?>/.test(t)) {
      t = t.replace(/^<\?[^>]*\?>/, '').trimStart();
      continue;
    }
    if (/^<!--/.test(t)) {
      const end = t.indexOf('-->');
      if (end === -1) return '';
      t = t.slice(end + 3).trimStart();
      continue;
    }
    if (/^<!doctype\s+[^>]*>/i.test(t)) {
      // HTML 的 doctype 本身就是判断依据，先看一眼再决定要不要剥掉
      if (/^<!doctype\s+html/i.test(t)) return t;
      t = t.replace(/^<!doctype\s+[^>]*>/i, '').trimStart();
      continue;
    }
    break;
  }
  return t;
}

/** 「只在 HTML 里成对出现」的标签，用来把没有 doctype 的 HTML 片段认出来 */
const HTML_HINTS = ['<body', '<div', '<span', '<table', '<ul', '<ol', '<li', '<form', '<button', '<h1', '<h2', '<section', '<header', '<footer', '<p>', '<p '];

/** markdown 特征（要求同时命中若干个，避免把普通笔记误判成 markdown） */
const MD_MARKERS: RegExp[] = [
  /^#{1,6}\s+\S/m,                          // 标题
  /^```/m,                                  // 围栏代码块
  /^\s*(?:[-*+]|\d+\.)\s+\S/m,              // 列表
  /^>\s+\S/m,                               // 引用
  /\[[^\]]+\]\([^)\s]+\)/,                  // 行内链接
  /(?:\*\*|__)[^\n]+(?:\*\*|__)/,           // 粗体
  /^\s*(-{3,}|\*{3,}|_{3,})\s*$/m           // 分隔线
];

function looksLikeMarkdown(text: string): boolean {
  const head = String(text || '').slice(0, 20000);
  if (head.split('\n').length < 4) return false;
  // 「标题 + 任一结构（代码块 / 列表 / 引用）」就已经很像 markdown 了：
  // 只靠计数会漏掉「标题 + 一堆列表项」这种最常见的笔记/文档（实测踩过）
  const heading = /^#{1,6}\s+\S/m.test(head);
  const fence = /^```/m.test(head) || /^~~~/m.test(head);
  const list = /^\s*(?:[-*+]|\d+\.)\s+\S/m.test(head);
  const quote = /^>\s+\S/m.test(head);
  if (heading && (fence || list || quote)) return true;
  let hits = 0;
  for (const re of MD_MARKERS) if (re.test(head)) hits++;
  return hits >= 3;
}

/**
 * 去掉围栏代码块，只留下「散文」部分。
 * 判断 markdown 时必须先剥掉代码：里面的 `const x = 1`、`def f():` 会让
 * detectLanguage 把整篇 md 认成 javascript / python（实测踩过），
 * 结果既没预览也没 markdown 高亮。
 */
export function proseOf(text: string): string {
  return String(text || '').replace(/```[\s\S]*?```/g, '\n').replace(/~~~[\s\S]*?~~~/g, '\n');
}

/**
 * 判断这个文本文件能不能渲染预览。认不出来就返回 null（照旧按文本/Hex 看）。
 * 顺序有意义：SVG → HTML → Markdown。markdown 的判断最宽松，必须放最后。
 */
export function detectPreview(text: string): PreviewKind | null {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const t = rootMarkup(raw);
  if (!t) return null;

  if (/^<svg[\s>]/i.test(t)) return 'svg';
  if (/^<!doctype\s+html/i.test(t) || /^<html[\s>]/i.test(t)) return 'html';

  const head = t.slice(0, 8192).toLowerCase();
  // PHP/模板之类别当成 HTML 预览（它们本来就渲染不了）
  if (!head.startsWith('<?php') && !head.startsWith('{{')) {
    let hits = 0;
    for (const h of HTML_HINTS) if (head.indexOf(h) !== -1) hits++;
    if (hits >= 3) return 'html';
  }

  // 1) 语言推断里那条 markdown 规则比较保守（要有围栏代码块或「标题+链接」）
  if (detectLanguage(raw) === 'markdown') return 'markdown';
  // 2) 判断一律基于**散文**（先剥掉围栏代码块）：
  //    代码里的 `const x = 1` / `def f():` 会让整篇 md 被认成 javascript / python
  const prose = proseOf(raw);
  //    但散文本身就是某种代码（有 shebang、关键字…）时，别误判成 markdown
  if (detectLanguage(prose)) return null;
  //    「散文里有标题」+「任意处有围栏代码块」＝ 技术文档最常见的样子
  if (/^\s*(```|~~~)/m.test(raw) && /^#{1,6}\s+\S/m.test(prose)) return 'markdown';
  if (looksLikeMarkdown(prose)) return 'markdown';
  return null;
}

// ---------- SVG 清理 ----------

/** 直接删掉的元素：脚本、外部文档、可嵌入内容 */
const SVG_DROP = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object', 'audio', 'video', 'canvas', 'handler', 'listener', 'set']);

/** 只允许指回文档内部（#锚点）或内联图片的链接属性 */
const SAFE_REF = /^(?:#|data:image\/)/i;

export interface SvgSanitizeResult {
  /** 清理后的 SVG 字符串（已序列化） */
  svg: string;
  /** 删掉了多少个可疑的东西（脚本 / 事件 / 外链），用于提示 */
  dropped: number;
}

/**
 * 清理 SVG：只保留绘图内容。
 * 主要目标是**去掉会跑代码或往外发请求的东西**，而不是重写整个文档模型——
 * 反正最后是当图片渲染（secure static mode 本来就不跑脚本、不取外部资源），这里只是加固。
 */
export function sanitizeSvg(src: string): SvgSanitizeResult | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(String(src || ''), 'image/svg+xml');
  } catch (e) {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length) return null;
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;

  let dropped = 0;

  /** 清掉一个元素上不该有的属性，返回是否动过 */
  function cleanAttrs(el: Element): void {
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      // 事件处理器：onload / onclick / onbegin…
      if (name.startsWith('on')) {
        el.removeAttribute(a.name);
        dropped++;
        continue;
      }
      // href / xlink:href / src：外链一律去掉（javascript: 也在这条里被拦掉）
      if ((name === 'href' || name === 'xlink:href' || name === 'src') && !SAFE_REF.test(String(a.value).trim())) {
        el.removeAttribute(a.name);
        dropped++;
      }
    }
  }

  function walk(el: Element): void {
    for (const child of Array.from(el.children)) {
      if (SVG_DROP.has(child.nodeName.toLowerCase())) {
        child.remove();
        dropped++;
        continue;
      }
      cleanAttrs(child);
      walk(child);
    }
  }

  cleanAttrs(root);
  walk(root);
  try {
    return { svg: new XMLSerializer().serializeToString(root), dropped };
  } catch (e) {
    return null;
  }
}

// ---------- 最小 markdown 渲染 ----------

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 链接/图片地址白名单；不在白名单里就按纯文本显示（比如 javascript:） */
function safeUrl(u: string): string | null {
  const s = String(u || '').trim();
  if (!s) return null;
  if (/^(?:https?:|mailto:|#)/i.test(s)) return s;
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(s)) return s;
  if (/^\.{0,2}\//.test(s)) return s; // 相对路径：交由文档内的 CSP 决定能不能取到
  return null;
}

/**
 * 行内标记。**先整体转义再套标签**：这样原文里的 HTML 只会变成可见文本，
 * 渲染器产出的标签全都由本函数生成，不存在「原样透传」的通路。
 */
function inline(s: string): string {
  let t = esc(s);
  // 行内代码先处理，避免里面的 * _ [ 被后面的规则吃掉
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]*)\)/g, (_m, alt: string, url: string) => {
    const u = safeUrl(url);
    return u ? `<img src="${esc(u)}" alt="${alt}" loading="lazy">` : esc(alt);
  });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]*)\)/g, (_m, txt: string, url: string) => {
    const u = safeUrl(url);
    return u ? `<a href="${esc(u)}" rel="noreferrer noopener" target="_blank">${txt}</a>` : txt;
  });
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return t;
}

/**
 * 极简 markdown → HTML：标题 / 列表 / 引用 / 围栏代码块 / 分隔线 + 常见行内标记。
 * 故意**不支持**表格、原始 HTML、脚注等——用不上的语法多支持一条就多一份风险，
 * 而且原文里的 HTML 现在是「显示为文本」而不是「当标签用」。
 */
export function renderMarkdown(text: string): string {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  function flushPara(): void {
    if (!para.length) return;
    out.push('<p>' + para.map(inline).join('<br>') + '</p>');
    para = [];
  }

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块：内容原样转义进 <pre>，语言名只用于 class（不引入高亮器）
    const fence = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const mark = fence[1];
      const langName = fence[2] || '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp('^\\s*' + mark + '\\s*$').test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // 吃掉收尾的那行
      out.push('<pre' + (langName ? ' data-lang="' + esc(langName) + '"' : '') + '><code>' + esc(body.join('\n')) + '</code></pre>');
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const lvl = h[1].length;
      out.push('<h' + lvl + '>' + inline(h[2].replace(/\s+#+\s*$/, '')) + '</h' + lvl + '>');
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + body.map(inline).join('<br>') + '</blockquote>');
      continue;
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered ? /^\s*\d+\.\s+(.*)$/.exec(lines[i]) : /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push('<li>' + inline(m[1]) + '</li>');
        i++;
      }
      out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return out.join('\n');
}

// ---------- 沙箱文档 ----------

/** 文档内的第二把锁：禁脚本、禁一切外部请求，只放开内联样式与内联图片 */
const PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; form-action 'none'; frame-src 'none'";

export type PreviewTheme = 'light' | 'dark';

export interface PreviewDocOpts {
  /** 文件所在的目录 URL：让文档里的相对路径按文件自身位置解析 */
  base: string;
  theme: PreviewTheme;
}

function cspMeta(): string {
  return '<meta http-equiv="Content-Security-Policy" content="' + PREVIEW_CSP + '">';
}

/** markdown 预览的排版：自己带一份样式，不依赖站点主题 */
function mdStyles(theme: PreviewTheme): string {
  const dark = theme === 'dark';
  return `<style>
:root { color-scheme: ${dark ? 'dark' : 'light'}; }
html, body { margin: 0; }
body {
  padding: 20px 22px 40px;
  background: ${dark ? '#1c1c1e' : '#ffffff'};
  color: ${dark ? '#e6e6e6' : '#1f2328'};
  font: 14px/1.7 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  word-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 .6em; line-height: 1.3; font-weight: 600; }
h1 { font-size: 1.7em; padding-bottom: .3em; border-bottom: 1px solid ${dark ? '#333' : '#e5e7eb'}; }
h2 { font-size: 1.4em; padding-bottom: .3em; border-bottom: 1px solid ${dark ? '#333' : '#e5e7eb'}; }
h3 { font-size: 1.2em; }
p { margin: .7em 0; }
a { color: ${dark ? '#6cb6ff' : '#0b6bcb'}; text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  padding: .15em .38em;
  border-radius: 5px;
  background: ${dark ? '#2c2c2e' : '#f2f3f5'};
  font: .92em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
pre {
  margin: .8em 0;
  padding: 12px 14px;
  overflow: auto;
  border-radius: 8px;
  background: ${dark ? '#252527' : '#f6f7f9'};
}
pre code { padding: 0; background: none; font-size: .9em; }
blockquote {
  margin: .8em 0;
  padding: 2px 0 2px 12px;
  border-left: 3px solid ${dark ? '#3a3a3c' : '#d7dbe0'};
  color: ${dark ? '#a8a8aa' : '#59636e'};
}
ul, ol { margin: .6em 0; padding-left: 1.7em; }
li { margin: .25em 0; }
hr { height: 1px; margin: 1.4em 0; border: 0; background: ${dark ? '#333' : '#e5e7eb'}; }
img { max-width: 100%; height: auto; }
</style>`;
}

/**
 * 组装给 `<iframe srcdoc>` 的文档。
 * - html：原样作为文档，但把 CSP 与 <base> 插到最前面（没有 <head> 就插到 <html> 后面）
 * - markdown：先转成 HTML，再套上自带的排版
 * 两个分支都**不含任何脚本**，且都带 CSP 头。
 */
/**
 * 去掉不受信任文档里的「自动导航」与「自己指定基准地址」：
 * - `<meta http-equiv="refresh">`：会在沙箱里把 iframe 自己导航到外部地址（顺带发信标），
 *   sandbox 管不了「帧内导航」，CSP 也没有对应指令，所以直接删掉这个标签。
 * - `<base>`：文档里自带的会把相对地址指到别处；我们注入的那条要成为唯一基准
 *   （放在 <head> 最前面，且这里先把原有的删干净）。
 * 属性顺序可能颠倒，所以按「整个标签里同时含 http-equiv 与 refresh」判断。
 */
function stripAutoNav(html: string): string {
  return String(html || '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, (tag) => {
      const t = tag.toLowerCase();
      return t.indexOf('http-equiv') !== -1 && t.indexOf('refresh') !== -1 ? '' : tag;
    });
}

/** 代码块高亮配色（hljs 的 token 类名）：浅色/深色各一套，只写进文档内部样式 */
function hljsStyles(theme: PreviewTheme): string {
  const dark = theme === 'dark';
  const c = dark
    ? { comment: '#8b949e', key: '#ff7b72', str: '#a5d6ff', num: '#79c0ff', title: '#d2a8ff', attr: '#7ee787' }
    : { comment: '#6a737d', key: '#d73a49', str: '#032f62', num: '#005cc5', title: '#6f42c1', attr: '#22863a' };
  return `<style>
.hljs-comment, .hljs-quote { color: ${c.comment}; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-doctag, .hljs-type, .hljs-name, .hljs-strong { color: ${c.key}; }
.hljs-string, .hljs-regexp, .hljs-addition, .hljs-meta .hljs-string { color: ${c.str}; }
.hljs-number, .hljs-built_in, .hljs-builtin-name, .hljs-variable, .hljs-template-variable, .hljs-symbol, .hljs-bullet, .hljs-link, .hljs-meta { color: ${c.num}; }
.hljs-title, .hljs-title.class_, .hljs-title.function_ { color: ${c.title}; }
.hljs-attr, .hljs-attribute, .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id, .hljs-selector-pseudo, .hljs-tag, .hljs-params { color: ${c.attr}; }
.hljs-emphasis { font-style: italic; }
pre.hljs, code.hljs { background: none; padding: 0; }
</style>`;
}

/**
 * HTML：原样作为文档，把 CSP 与 <base> 插到最前面（没有 <head> 就插到 <html> 后面）。
 * 顺带做 stripAutoNav 的清理（去掉自动跳转与自带 base）。
 */
export function buildHtmlDoc(content: string, opts: PreviewDocOpts): string {
  const head = cspMeta() + (opts.base ? '<base href="' + esc(opts.base) + '">' : '');
  const src = stripAutoNav(content);
  // 已有 <head>：插到它后面；只有 <html>：插到它后面；只是片段：放到最前面
  const headOpen = /<head\b[^>]*>/i.exec(src);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return src.slice(0, at) + head + src.slice(at);
  }
  const htmlOpen = /<html\b[^>]*>/i.exec(src);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return src.slice(0, at) + '<head>' + head + '</head>' + src.slice(at);
  }
  return '<!DOCTYPE html><html><head><meta charset="utf-8">' + head + '</head><body>' + src + '</body></html>';
}

/**
 * Markdown：传入**已经渲染好**的正文 HTML。
 * 单独一个函数是为了让调用方先把围栏代码块用 hljs 高亮（那步是异步的），
 * 这里只负责套排版与代码配色。
 */
export function buildMarkdownDoc(bodyHtml: string, opts: PreviewDocOpts): string {
  const theme = opts.theme === 'dark' ? 'dark' : 'light';
  const head = cspMeta() + (opts.base ? '<base href="' + esc(opts.base) + '">' : '');
  return '<!DOCTYPE html><html><head><meta charset="utf-8">' + head + mdStyles(theme) + hljsStyles(theme) +
    '</head><body>' + bodyHtml + '</body></html>';
}
