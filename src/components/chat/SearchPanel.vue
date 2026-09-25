<script setup lang="ts">
/* ============================================================
 * 聊天记录搜索（右侧抽屉）
 *
 * 两个范围：
 *   room —— 只搜当前会话（群里搜群、私聊里搜对方）；入口在聊天页头部
 *   all  —— 搜我的全部会话（群 + 私聊），结果里标出属于哪个会话；入口在侧栏
 *
 * 点结果 → 切到所在会话并把那条消息滚到中间高亮（jumpToMessage 自带重试）。
 * 只搜文本消息，不含已撤回 / 已过期的；每个房间只保留最近 500 条，
 * 更早的记录本来就已不在库里。
 * ============================================================ */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { chatState, closeSearch, runSearch, setSearchScope, searchJump } from '../../core/chat';
import { fmtDateTime } from '../../core/format';
import { tr } from '../../core/i18n';
import type { SearchHit } from '../../types';

const inputEl = ref<HTMLInputElement | null>(null);
let timer: number | undefined;

const query = computed(() => chatState.searchQuery.trim());

/** 当前会话的名字（会话内搜索时给用户看清搜的是哪儿） */
const roomLabel = computed(() => {
  if (chatState.activeGid != null) {
    const g = chatState.myGroups.find((x) => String(x.id) === String(chatState.activeGid));
    return g ? g.name : tr('chat.group.untitled');
  }
  return chatState.activeDmPeer != null ? chatState.activeDmPeer : '';
});

/** 「全部会话」模式下，这条结果属于哪个会话 */
function hitRoom(h: SearchHit): string {
  if (h.dm) return String(h.dm).split(':').find((n) => n !== chatState.me) || '';
  const g = chatState.myGroups.find((x) => String(x.id) === String(h.gid));
  return g ? g.name : String(h.gid == null ? '' : h.gid);
}

/** 输入防抖：连续输入只发最后一次请求 */
function onInput(e: Event): void {
  chatState.searchQuery = (e.target as HTMLInputElement).value;
  clearTimeout(timer);
  timer = window.setTimeout(runSearch, 260);
}

/** 把片段按关键词切成「普通 / 命中」两段，交给模板渲染（不用 v-html） */
function parts(text: string, kw: string): { t: string; hit: boolean }[] {
  const out: { t: string; hit: boolean }[] = [];
  const src = String(text || '');
  if (!kw) return [{ t: src, hit: false }];
  const lower = src.toLowerCase();
  const key = kw.toLowerCase();
  let i = 0;
  while (i < src.length) {
    const at = lower.indexOf(key, i);
    if (at === -1) {
      out.push({ t: src.slice(i), hit: false });
      break;
    }
    if (at > i) out.push({ t: src.slice(i, at), hit: false });
    out.push({ t: src.slice(at, at + key.length), hit: true });
    i = at + key.length;
  }
  return out;
}

function pick(h: SearchHit): void {
  searchJump(h);
  // 窄屏下面板是铺满的：不收起就看不到刚跳过去的那条消息
  if (window.innerWidth <= 640) closeSearch();
}

// 面板打开时聚焦输入框
watch(
  () => chatState.searchOpen,
  (open) => {
    if (!open) return;
    void nextTick(() => inputEl.value && inputEl.value.focus());
  },
  { immediate: true }
);

// 会话内搜索：切了会话就重新搜（结果都是旧会话的就没意义了）
watch(
  () => [chatState.activeGid, chatState.activeDmPeer],
  () => {
    if (chatState.searchOpen && chatState.searchScope === 'room' && query.value) runSearch();
  }
);

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <aside v-if="chatState.searchOpen" class="search-panel" role="dialog" :aria-label="tr('chat.search.title')">
    <div class="sp-head">
      <span class="sp-title">{{ tr('chat.search.title') }}</span>
      <button type="button" class="sp-close" :title="tr('common.close')" :aria-label="tr('common.close')" @click="closeSearch()">×</button>
    </div>

    <div class="sp-scope">
      <button
        type="button"
        class="sp-tab"
        :class="{ on: chatState.searchScope === 'room' }"
        :disabled="!roomLabel"
        @click="setSearchScope('room')"
      >
        {{ tr('chat.search.room') }}
        <em v-if="roomLabel" class="sp-tab-sub">{{ roomLabel }}</em>
      </button>
      <button
        type="button"
        class="sp-tab"
        :class="{ on: chatState.searchScope === 'all' }"
        @click="setSearchScope('all')"
      >{{ tr('chat.search.all') }}</button>
    </div>

    <input
      ref="inputEl"
      class="sp-input"
      type="text"
      maxlength="64"
      :value="chatState.searchQuery"
      :placeholder="tr('chat.search.placeholder')"
      @input="onInput"
    />

    <p class="sp-meta">
      <span v-if="chatState.searchLoading">{{ tr('common.loading') }}</span>
      <span v-else-if="query">{{ tr('chat.search.count', { n: chatState.searchTotal }) }}</span>
    </p>

    <div class="sp-body">
      <p v-if="!query" class="sp-hint">{{ tr('chat.search.hint') }}</p>
      <p v-else-if="chatState.searchError" class="sp-hint">{{ tr(chatState.searchError) }}</p>
      <p v-else-if="!chatState.searchLoading && !chatState.searchHits.length" class="sp-hint">
        {{ tr('chat.search.empty') }}
      </p>

      <button v-for="h in chatState.searchHits" :key="h.idx" type="button" class="sp-hit" @click="pick(h)">
        <span class="sp-hit-top">
          <b class="sp-from">{{ h.from }}</b>
          <span v-if="chatState.searchScope === 'all'" class="sp-room">{{ hitRoom(h) }}</span>
          <span class="sp-time">{{ fmtDateTime(h.ts) }}</span>
        </span>
        <span class="sp-snippet">
          <span
            v-for="(p, i) in parts(h.content, query)"
            :key="i"
            :class="{ 'sp-mark': p.hit }"
          >{{ p.t }}</span>
        </span>
      </button>
    </div>
  </aside>
</template>
