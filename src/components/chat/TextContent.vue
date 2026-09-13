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

const props = defineProps<{ text: string }>();

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
</script>

<template>
  <div class="chat-text">
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
  </div>
</template>
