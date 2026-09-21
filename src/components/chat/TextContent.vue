<script setup lang="ts">
/* 安全文本渲染：把消息正文解析为 文本 / 链接 / @提及 / 行内代码 / 代码块。
 * 纯文本走 Vue 的文本插值（自动转义），只有经过 highlight.js 转义后的代码块才用 v-html，
 * 因此不存在 XSS 风险。 */
import { computed } from 'vue';
import hljs from 'highlight.js/lib/common';
import { chatState, tr, copyToClipboard } from '../../core/chat';
import { renderMath, mathReady } from '../../core/math';

interface Token {
  t: 'text' | 'mention' | 'link' | 'code';
  v: string;
  href?: string;
}
interface Block {
  code: boolean;
  lang?: string;
  text?: string;
  tokens?: Token[];
}

function safeHref(u: string): string {
  if (/^(?:https?:|mailto:)/i.test(u)) return u;
  return '#';
}

function parseInline(text: string): Token[] {
  const tokens: Token[] = [];
  const names = chatState.allUsers
    .map((u) => u.name)
    .sort((a, b) => b.length - a.length);
  const nameAlt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re: RegExp = nameAlt
    ? new RegExp('(https?://[^\\s<]+)|(`[^`]+`)|(@(?:' + nameAlt + '))', 'g')
    : /(https?:\/\/[^\s<]+)|(`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1]) tokens.push({ t: 'link', v: m[1], href: m[1] });
    else if (m[2]) tokens.push({ t: 'code', v: m[2].slice(1, -1) });
    else if (m[3]) tokens.push({ t: 'mention', v: m[3].slice(1) });
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push({ t: 'text', v: text.slice(last) });
  return tokens;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string;
  });
}

// 语法高亮：语言未知 / 出错时退回纯文本，保证任何情况都能显示
function highlight(code: string, lang?: string): string {
  try {
    const name = String(lang || '').toLowerCase();
    if (name && hljs.getLanguage(name)) {
      return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
    }
    if (code.length <= 20000) return hljs.highlightAuto(code).value;
  } catch {
    /* 退回纯文本 */
  }
  return escapeHtml(code);
}

// 行号列：按代码行数生成 1..N
function lineNumbers(text: string): string {
  const n = (text || '').split('\n').length;
  let s = '';
  for (let i = 1; i <= n; i++) s += i + '\n';
  return s.replace(/\n$/, '');
}
function copyCode(text?: string): void {
  copyToClipboard(text || '');
}

const props = defineProps<{ text: string; md?: boolean }>();

const blocks = computed<Block[]>(() => {
  const out: Block[] = [];
  const FENCE = /```(\w*)\n?([\s\S]*?)```/g;
  const src = props.text || '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE.exec(src)) !== null) {
    if (m.index > last) out.push({ code: false, tokens: parseInline(src.slice(last, m.index)) });
    out.push({ code: true, lang: m[1] || undefined, text: m[2].replace(/\n$/, '') });
    last = FENCE.lastIndex;
  }
  if (last < src.length) out.push({ code: false, tokens: parseInline(src.slice(last)) });
  return out;
});

/* ============================================================
 * Markdown 渲染（自研安全子集）
 * 流程：先把用户内容整体 HTML 转义，再仅在转义后的文本上套用自带的
 * 结构标签（用占位符保护内联代码避免被穿套），因此不可能注入脚本。
 * 覆盖：标题 / 段落 / ul/ol 列表 / 表格 / 引用 / 分隔线 / 围栏代码块 /
 * 加粗 / 斜体 / 删除线 / 行内代码 / 链接（仅 http(s)/mailto）。
 * ============================================================ */

/** 带 hljs 高亮的代码块 HTML（失败时退回转义纯文本） */
function mdCode(lang: string | undefined, text: string): string {
  const h = highlight(text || '', lang);
  return (
    '<div class="code-block"><div class="code-head"><span class="code-lang">' +
    (lang || 'text') +
    '</span><button type="button" class="code-copy">' +
    tr('common.copy') +
    '</button></div><div class="code-body"><pre class="code-gutter">' +
    lineNumbers(text || '') +
    '</pre><pre class="code-pre"><code>' +
    h +
    '</code></pre></div></div>'
  );
}

/** 行内 Markdown：转义后先对「代码 / 链接」做占位保护，再加粗/斜体等，最后整体还原 */
function mdInline(s: string): string {
  let out = escapeHtml(s);
  const html: string[] = [];
  const stash = (h: string): string => {
    html.push(h);
    return '\u0001' + (html.length - 1) + '\u0001';
  };
  // 1) 行内代码 / Markdown 链接 / 裸链接：先占位，避免被后续规则穿套或二次包裹
  out = out.replace(/(`+)((?:(?!\1)[\s\S])*?)\1/g, (_all, _q: string, body: string) => {
    return stash('<code class="inline-code">' + body + '</code>');
  });
  out = out.replace(
    /\[([^\]]*)\]\(((?:https?:\/\/|mailto:)[^)\s<]+)\)/g,
    (_all, t: string, u: string) =>
      stash('<a href="' + u + '" target="_blank" rel="noopener noreferrer" class="chat-link">' + t + '</a>')
  );
  out = out.replace(/(https?:\/\/[^\s<]+)/g, (u: string) =>
    stash('<a href="' + u + '" target="_blank" rel="noopener noreferrer" class="chat-link">' + u + '</a>')
  );
  // 2) 加粗 / 斜体 / 删除线（在纯文本上套标签）
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*(?=$|[^\w_*])/g, '<em>$1</em>');
  out = out.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  // 3) @提及：按实际用户名匹配（与纯文本模式口径一致，支持中文用户名）
  const names = chatState.allUsers.map((u) => u.name).filter(Boolean).sort((a, b) => b.length - a.length);
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (alt) {
    out = out.replace(new RegExp('@(' + alt + ')(?=[\\s，。；！？、<]|$)', 'g'), '<span class="mention">@$1</span>');
  }
  // 4) 还原被保护的代码 / 链接
  out = out.replace(/\u0001(\d+)\u0001/g, (_a, i: string) => html[Number(i)] || '');
  return out;
}

/** 提取数学公式为占位符（避免被 Markdown 规则/转义破坏），返回替换后的文本 */
function extractMath(src: string, store: { html: string; display: boolean }[]): string {
  const put = (tex: string, display: boolean): string => {
    const svg = renderMath(tex, display);
    const inner = svg || escapeHtml((display ? '$$' : '$') + tex + (display ? '$$' : '$'));
    store.push({
      html: display ? '<div class="math-block">' + inner + '</div>' : '<span class="math-inline">' + inner + '</span>',
      display
    });
    return '\u0002M' + (store.length - 1) + '\u0002';
  };
  return String(src || '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, t: string) => put(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, t: string) => put(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, t: string) => put(t, false))
    // 行内 $...$：要求内容含字母/反斜杠/上下标，避免把「$5」这类金额误判为公式
    .replace(/\$([^$\n]+?)\$/g, (m: string, t: string) => (/[A-Za-z\\^_{}]/.test(t) ? put(t, false) : m));
}

/* ---------- 表格（GFM） ---------- */

/** 拆一行表格：去掉首尾的 | 再按 | 切分；\| 是转义的竖线，先占位免得被当分隔符 */
function splitRow(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\\\|/g, '\u0003');
  return s.split('|').map((c) => c.replace(/\u0003/g, '|').trim());
}

/** 分隔行判定：| --- | :--: | 这种（每个单元格只能是 - 和可选的冒号） */
function isTableDelim(line: string): boolean {
  if (!line || line.indexOf('-') === -1) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** 由分隔行得出每列对齐方式（返回 style 值，空串表示默认） */
function tableAligns(line: string): string[] {
  return splitRow(line).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
}

/** 整段 Markdown 块级渲染为安全 HTML */
function renderMd(src: string): string {
  const math: { html: string; display: boolean }[] = [];
  const lines = extractMath(String(src || '').replace(/\r\n?/g, '\n'), math).split('\n');
  const html: string[] = [];
  let para: string[] = []; // 待合并的普通段落行

  const flush = (): void => {
    if (!para.length) return;
    html.push('<p>' + para.map((l) => mdInline(l)).join('<br>') + '</p>');
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 独占一行的块级公式：直接作为块输出（避免被 <p> 包裹）
    const onlyMath = /^\s*\u0002M(\d+)\u0002\s*$/.exec(line);
    if (onlyMath) {
      const idx = Number(onlyMath[1]);
      if (math[idx] && math[idx].display) {
        flush();
        html.push(math[idx].html);
        i++;
        continue;
      }
    }

    // 围栏代码块
    const fence = /^\s*```\s*(\w*)\s*$/.exec(line);
    if (fence) {
      flush();
      const lang = fence[1] || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾 ```
      html.push(mdCode(lang, buf.join('\n')));
      continue;
    }

    // 标题
    const head = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      flush();
      const lv = head[1].length;
      html.push(`<h${lv}>` + mdInline(head[2]) + `</h${lv}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      flush();
      html.push('<hr>');
      i++;
      continue;
    }

    // 表格（GFM）：本行含 | 且下一行是分隔行 | --- | --- | 才算，
    // 所以普通文本里出现竖线不会被误判成表格。
    if (line.indexOf('|') !== -1 && i + 1 < lines.length && isTableDelim(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      const aligns = tableAligns(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') !== -1 && !isTableDelim(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      // 列数以表头 / 分隔行 / 正文里最多的为准，缺格的补空，多出来的也显示
      const cols = Math.max(head.length, aligns.length, ...rows.map((r) => r.length));
      const cell = (tag: 'th' | 'td', text: string, c: number): string => {
        const al = aligns[c];
        return '<' + tag + (al ? ' style="text-align:' + al + '"' : '') + '>' + (text ? mdInline(text) : '') + '</' + tag + '>';
      };
      let table = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
      for (let c = 0; c < cols; c++) table += cell('th', head[c] || '', c);
      table += '</tr></thead><tbody>';
      for (const row of rows) {
        table += '<tr>';
        for (let c = 0; c < cols; c++) table += cell('td', row[c] || '', c);
        table += '</tr>';
      }
      table += '</tbody></table></div>';
      html.push(table);
      continue;
    }

    // 列表（连续收集）：无序 / 有序 / 任务清单 - [ ] / - [x]
    const ulItem = /^\s*[-+*]\s+(.*)$/.exec(line);
    const olItem = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ulItem || olItem) {
      flush();
      const ordered: boolean = !!olItem;
      // 直接存完整的 <li>，因为任务项要输出带 class 的 li，不能再统一包一层
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const task = /^\s*[-+*]\s+\[([ xX])\]\s*(.*)$/.exec(l);
        if (!ordered && task) {
          const checked = task[1].toLowerCase() === 'x';
          items.push(
            '<li class="md-task' + (checked ? ' done' : '') + '">' +
            '<span class="md-check' + (checked ? ' on' : '') + '" aria-hidden="true">' + (checked ? '✓' : '') + '</span>' +
            '<span class="md-task-text">' + mdInline(task[2]) + '</span></li>'
          );
          i++;
          continue;
        }
        const u = /^\s*[-+*]\s+(.*)$/.exec(l);
        const o = /^\s*\d+\.\s+(.*)$/.exec(l);
        if (ordered) {
          if (!o) break;
          items.push('<li>' + mdInline(o[1]) + '</li>');
        } else {
          if (!u) break;
          items.push('<li>' + mdInline(u[1]) + '</li>');
        }
        i++;
      }
      // 原来无论有序无序都输出 <ul>，有序列表的编号被吃掉、全变成圆点
      const tag = ordered ? 'ol' : 'ul';
      html.push('<' + tag + ' class="md-list">' + items.join('') + '</' + tag + '>');
      continue;
    }

    // 引用（连续收集）
    if (/^\s*>/.test(line)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*> ?/, ''));
        i++;
      }
      html.push('<blockquote>' + buf.map((l) => mdInline(l)).join('<br>') + '</blockquote>');
      continue;
    }

    // 空行：结束当前段落
    if (line.trim() === '') {
      flush();
      i++;
      continue;
    }

    // 其余普通文本：累积成段落
    para.push(line);
    i++;
  }
  flush();
  return html.join('').replace(/\u0002M(\d+)\u0002/g, (_a, i: string) => math[Number(i)]?.html || '');
}

/** Markdown 渲染出的 HTML（仅当 md=true 时使用；已整体转义，安全） */
const mdHtml = computed<string>(() => {
  if (!props.md) return '';
  void mathReady.value; // 公式模块加载完成后触发重渲染
  return renderMd(props.text || '');
});

// Markdown 内代码块的「复制」走事件委托（v-html 无法直接绑定）
function onMdClick(e: Event): void {
  const t = e.target as HTMLElement | null;
  if (!t || !t.closest) return;
  const btn = t.closest('.code-copy');
  if (!btn) return;
  const block = btn.closest('.code-block');
  const code = block && block.querySelector('.code-pre code');
  if (code) copyToClipboard((code as HTMLElement).innerText || '');
}
</script>

<template>
  <div class="chat-text" :class="{ 'chat-md': md }">
    <template v-if="md">
      <div class="md-root" v-html="mdHtml" @click="onMdClick"></div>
    </template>
    <template v-else>
      <template v-for="(b, bi) in blocks" :key="bi">
        <div v-if="b.code" class="code-block">
          <div class="code-head">
            <span class="code-lang">{{ b.lang || 'text' }}</span>
            <button type="button" class="code-copy" @click="copyCode(b.text)">{{ tr('common.copy') }}</button>
          </div>
          <div class="code-body">
            <pre class="code-gutter">{{ lineNumbers(b.text || '') }}</pre>
            <pre class="code-pre"><code v-html="highlight(b.text || '', b.lang)"></code></pre>
          </div>
        </div>
        <span v-else class="text-seg"><template v-for="(tk, ti) in b.tokens" :key="ti">
          <a v-if="tk.t === 'link'" :href="safeHref(tk.href || '')" target="_blank" rel="noopener noreferrer" class="chat-link">{{ tk.v }}</a>
          <code v-else-if="tk.t === 'code'" class="inline-code">{{ tk.v }}</code>
          <span v-else-if="tk.t === 'mention'" class="mention">@{{ tk.v }}</span>
          <template v-else>{{ tk.v }}</template>
        </template></span>
      </template>
    </template>
  </div>
</template>
