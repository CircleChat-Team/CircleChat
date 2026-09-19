<script setup lang="ts">
/* 安全文本渲染：把消息正文解析为 文本 / 链接 / @提及 / 行内代码 / 代码块。
 * 纯文本走 Vue 的文本插值（自动转义），只有经过 highlight.js 转义后的代码块才用 v-html，
 * 因此不存在 XSS 风险。 */
import { computed } from 'vue';
import { chatState, tr, copyToClipboard } from '../../core/chat';

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

// 语法高亮：highlight.js 未加载 / 语言未知 / 出错时退回纯文本，保证任何情况都能显示
function highlight(code: string, lang?: string): string {
  const hl = (window as unknown as { hljs?: any }).hljs;
  try {
    if (hl) {
      const name = String(lang || '').toLowerCase();
      if (name && hl.getLanguage && hl.getLanguage(name)) {
        return hl.highlight(code, { language: name, ignoreIllegals: true }).value;
      }
      if (code.length <= 20000 && hl.highlightAuto) return hl.highlightAuto(code).value;
    }
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
 * 覆盖：标题 / 段落 / ul/ol 列表 / 引用 / 分隔线 / 围栏代码块 /
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

/** 整段 Markdown 块级渲染为安全 HTML */
function renderMd(src: string): string {
  const lines = String(src || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
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

    // 无序 / 有序列表（连续收集）
    const ulItem = /^\s*[-+*]\s+(.*)$/.exec(line);
    const olItem = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ulItem || olItem) {
      flush();
      const ordered: boolean = !!olItem;
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const u = /^\s*[-+*]\s+(.*)$/.exec(l);
        const o = /^\s*\d+\.\s+(.*)$/.exec(l);
        if (ordered) {
          if (!o) break;
          items.push(mdInline(o[1]));
        } else {
          if (!u) break;
          items.push(mdInline(u[1]));
        }
        i++;
      }
      html.push('<ul class="md-list">' + items.map((it) => '<li>' + it + '</li>').join('') + '</ul>');
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
  return html.join('');
}

/** Markdown 渲染出的 HTML（仅当 md=true 时使用；已整体转义，安全） */
const mdHtml = computed<string>(() => {
  if (!props.md) return '';
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
