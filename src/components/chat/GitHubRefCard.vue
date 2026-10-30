<script setup lang="ts">
/* ============================================================
 * 消息里的 GitHub Issue / Pull Request / Commit 卡片
 *
 * 链接类型由 core/repolink 的 extractGithub 识别：
 *  - Issue / PR：都走 issueInfo()（GitHub 编号互通，服务端按 isPr 补齐 PR 数据）
 *  - commit：走 commitInfo()
 * 数据缓存与仓库卡片一致（60 秒内不重复请求；服务端另有 10 分钟缓存）。
 * ============================================================ */
import { computed } from 'vue';
import type { GithubRef } from '../../core/github';
import { issueInfo, commitInfo, timeAgoText } from '../../core/github';
import { tr } from '../../core/i18n';

const props = defineProps<{ refData: GithubRef }>();

const isCommit = computed(() => props.refData.type === 'commit');

const entry = computed(() =>
  isCommit.value
    ? commitInfo(props.refData.repo, props.refData.sha || '')
    : issueInfo(props.refData.repo, props.refData.num || 0)
);

// 联合类型抹平：两种条目结构相同，用 any 取字段避免 TS 联合展开的噪音
const data = computed(() => entry.value.data as any);

/**
 * 拿不到信息就整张卡都不画（只留消息里原本的链接）。
 * 私有仓库 / 未公开的 issue 会返回 404，画一张「不存在」的卡片对收链接的人纯属噪音。
 * 限流/网络这类临时失败仍然画卡片，并说明原因。
 */
const hidden = computed(
  () => !entry.value.loading && !data.value && entry.value.code === 'github.notFound'
);

/** 打开 GitHub 的地址：优先用接口返回的 html，失败时按链接类型自己拼 */
const openUrl = computed(() => {
  if (data.value && data.value.html) return data.value.html;
  const r = props.refData;
  if (r.type === 'commit') return 'https://github.com/' + r.repo + '/commit/' + (r.sha || '');
  if (r.type === 'issue') return 'https://github.com/' + r.repo + '/issues/' + (r.num || '');
  if (r.type === 'pr') return 'https://github.com/' + r.repo + '/pull/' + (r.num || '');
  return 'https://github.com/' + r.repo;
});

/** 类型标签：以服务端判定为准（issue 链接也可能指向 PR） */
const isPrLabel = computed(() => (data.value ? !!data.value.isPr : props.refData.type === 'pr'));

/** 状态：开放 / 已关闭 / 已合并 */
const stateText = computed(() => {
  const d = data.value;
  if (!d || isCommit.value) return '';
  if (d.isPr && d.merged) return tr('github.state.merged');
  return tr(d.state === 'closed' ? 'github.state.closed' : 'github.state.open');
});
</script>

<template>
  <div v-if="!hidden" class="repo-card gh-ref-card" @click.stop>
    <div class="rc-head">
      <span class="rc-gh" aria-hidden="true">
        <svg viewBox="0 0 16 16" class="rc-gh-icon">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
      </span>
      <span class="rc-name">
        {{ refData.repo }}
        <template v-if="!isCommit && refData.num">#{{ refData.num }}</template>
        <template v-else-if="isCommit && data"> · <span class="gh-sha">{{ data.shortSha }}</span></template>
      </span>
      <span v-if="data" class="gh-type">{{
        tr(isCommit ? 'github.commit' : (isPrLabel ? 'github.pull' : 'github.issue'))
      }}</span>
      <span
        v-if="stateText"
        class="gh-state"
        :class="{
          'is-open': data.state === 'open',
          'is-merged': data.isPr && data.merged,
          'is-closed': data.state === 'closed' && !(data.isPr && data.merged)
        }"
      >{{ stateText }}</span>
      <span v-if="entry.stale" class="rc-stale">{{ tr('github.stale') }}</span>
    </div>

    <div v-if="entry.loading && !data" class="rc-skel">
      <span class="rc-skel-line w70"></span>
      <span class="rc-skel-line w40"></span>
    </div>

    <!-- 取不到：给一行原因 + 直达 GitHub 的链接，别让卡片变成死块 -->
    <template v-else-if="!data">
      <p class="rc-err">{{ tr(entry.code || 'github.failed') }}</p>
      <a class="rc-link" :href="openUrl" target="_blank" rel="noopener noreferrer">
        {{ openUrl.replace(/^https?:\/\//, '') }} ↗
      </a>
    </template>

    <!-- commit 卡 -->
    <template v-else-if="isCommit">
      <p class="gh-title">{{ data.message }}</p>
      <div class="gh-meta">
        <img v-if="data.avatar" class="gh-avatar" :src="data.avatar" alt="" loading="lazy" referrerpolicy="no-referrer" />
        <span v-if="data.author" class="gh-author">{{ data.author }}</span>
        <span v-if="data.date" class="gh-time">{{ timeAgoText(data.date) }}</span>
      </div>
      <div class="rc-actions">
        <a class="rc-btn rc-btn-ghost" :href="openUrl" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
      </div>
    </template>

    <!-- issue / PR 卡 -->
    <template v-else>
      <p class="gh-title">{{ data.title }}</p>
      <div v-if="data.labels && data.labels.length" class="gh-labels">
        <span
          v-for="l in data.labels.slice(0, 6)"
          :key="l.name"
          class="gh-label"
          :style="{ color: '#' + l.color, borderColor: '#' + l.color + '66', background: '#' + l.color + '1f' }"
        >{{ l.name }}</span>
      </div>
      <div class="gh-meta">
        <span v-if="data.author" class="gh-author">{{ data.author }}</span>
        <span v-if="data.comments" class="gh-comments">💬 {{ data.comments }}</span>
        <span v-if="data.isPr && data.additions != null" class="gh-diff">
          <span class="gh-add">+{{ data.additions }}</span>
          <span class="gh-del">−{{ data.deletions }}</span>
          <span v-if="data.changedFiles != null" class="gh-files">{{ tr('github.changedFiles', { n: data.changedFiles }) }}</span>
        </span>
        <span v-if="data.createdAt" class="gh-time">{{ timeAgoText(data.createdAt) }}</span>
      </div>
      <div class="rc-actions">
        <a class="rc-btn rc-btn-ghost" :href="openUrl" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
      </div>
    </template>
  </div>
</template>
