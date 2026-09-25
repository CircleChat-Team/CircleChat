<script setup lang="ts">
/* ============================================================
 * GitHub 仓库详情弹窗
 *
 * 由消息里的仓库卡片点「展开详细信息」打开。内容参考 web 端仓库信息页
 * （server/app/about/repository + components/repo-info-section）：
 * 仓库描述 / 主题标签 / 统计（Stars、Forks、Watchers、Issues、许可证、体积）
 * / 语言构成占比条 / 最新版本 / 提交时间线 / 贡献者。
 *
 * 取数上刻意分两步：
 *  - 仓库主信息复用卡片那份缓存（repoBasic），**不重复请求**；
 *  - 只有本弹窗独有的几块（贡献者 / 语言 / 发布 / 提交）才发一次 detail 请求，
 *    所以从「基础信息 → 展开」整个链路，每个仓库一共两次请求，且都带缓存。
 * ============================================================ */
import { computed, ref } from 'vue';
import { chatState, closeRepoView } from '../../core/chat';
import { tr } from '../../core/i18n';
import { repoBasic, repoDetail, formatCount, formatSizeKb, langColor, timeAgoText, fmtDay } from '../../core/github';
import { useOverlay } from '../../core/useOverlay';

const full = computed(() => chatState.repoView || '');
const basicEntry = computed(() => (full.value ? repoBasic(full.value) : null));
const detailEntry = computed(() => (full.value ? repoDetail(full.value) : null));
const repo = computed(() => (basicEntry.value ? basicEntry.value.data : null));
const detail = computed(() => (detailEntry.value ? detailEntry.value.data : null));

const langs = computed(() => {
  const rows = Object.entries((detail.value && detail.value.languages) || {});
  const total = rows.reduce((sum, r) => sum + (Number(r[1]) || 0), 0);
  if (!total) return [];
  return rows
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map((r) => ({ name: r[0], percent: ((Number(r[1]) || 0) / total) * 100 }));
});

/** 这个分块是「取失败」还是「仓库真的没有」——空数据两种情况得分开说，
 *  否则限流时会显示成「暂无提交记录」，让人以为仓库没提交 */
function secFailed(name: string): boolean {
  const f = detail.value && detail.value.failed;
  return !!f && f.indexOf(name) !== -1;
}

const html = computed(() => (repo.value ? repo.value.html : 'https://github.com/' + full.value));
const branch = computed(() => (repo.value && repo.value.branch ? repo.value.branch : 'main'));

const rootEl = ref<HTMLElement | null>(null);
useOverlay({
  isOpen: () => !!full.value,
  onClose: closeRepoView,
  container: () => rootEl.value
});
</script>

<template>
  <div v-if="full" ref="rootEl" class="repo-mask" @click.self="closeRepoView">
    <div class="repo-modal">
      <div class="repo-mhead">
        <span class="rc-gh" aria-hidden="true">
          <svg viewBox="0 0 16 16" class="rc-gh-icon">
            <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </span>
        <span class="repo-mtitle">{{ repo ? repo.full : full }}</span>
        <span v-if="basicEntry && basicEntry.stale" class="repo-stale">{{ tr('github.stale') }}</span>
        <button type="button" class="repo-x" :title="tr('common.close')" :aria-label="tr('common.close')" @click="closeRepoView">×</button>
      </div>

      <div class="repo-mbody">
        <!-- 仓库头部：描述 + 主题 + 入口 -->
        <section class="repo-hero">
          <p v-if="repo && repo.description" class="repo-desc">{{ repo.description }}</p>
          <p v-else-if="basicEntry && basicEntry.loading" class="repo-skel w60"></p>
          <div v-if="repo && repo.topics.length" class="repo-tags">
            <span v-for="t in repo.topics" :key="t" class="repo-tag">{{ t }}</span>
          </div>
          <div class="repo-hero-actions">
            <a class="repo-btn" :href="html" target="_blank" rel="noopener noreferrer">{{ tr('github.open') }}</a>
            <a class="repo-btn" :href="html + '/issues'" target="_blank" rel="noopener noreferrer">{{ tr('github.issues') }}</a>
            <span v-if="repo && repo.pushedAt" class="repo-push">
              {{ tr('github.lastPush', { time: timeAgoText(repo.pushedAt) }) }}
            </span>
          </div>
        </section>

        <div class="repo-grid">
          <div class="repo-stat">
            <span class="repo-stat-k">{{ tr('github.stars') }}</span>
            <b class="repo-stat-v">{{ repo ? formatCount(repo.stars) : '—' }}</b>
          </div>
          <div class="repo-stat">
            <span class="repo-stat-k">{{ tr('github.forks') }}</span>
            <b class="repo-stat-v">{{ repo ? formatCount(repo.forks) : '—' }}</b>
          </div>
          <div class="repo-stat">
            <span class="repo-stat-k">{{ tr('github.watchers') }}</span>
            <b class="repo-stat-v">{{ repo ? formatCount(repo.watchers) : '—' }}</b>
          </div>
          <div class="repo-stat">
            <span class="repo-stat-k">{{ tr('github.openIssues') }}</span>
            <b class="repo-stat-v">{{ repo ? formatCount(repo.issues) : '—' }}</b>
          </div>
          <div class="repo-stat">
            <span class="repo-stat-k">{{ tr('github.license') }}</span>
            <b class="repo-stat-v">{{ repo && repo.license ? repo.license : '—' }}</b>
          </div>
          <div class="repo-stat">
            <span class="repo-stat-k">{{ tr('github.size') }}</span>
            <b class="repo-stat-v">{{ repo ? formatSizeKb(repo.sizeKb) : '—' }}</b>
          </div>
        </div>

        <section class="repo-sec">
          <div class="repo-sec-head">
            <h4 class="repo-sec-t">{{ tr('github.languages') }}</h4>
            <span class="repo-sec-hint">{{ tr('github.languagesHint') }}</span>
          </div>
          <div v-if="langs.length" class="repo-langs">
            <div class="repo-lang-bar">
              <span
                v-for="l in langs"
                :key="l.name"
                :style="{ width: l.percent + '%', background: langColor(l.name) }"
                :title="l.name + ' ' + l.percent.toFixed(1) + '%'"
              ></span>
            </div>
            <div class="repo-lang-legend">
              <span v-for="l in langs" :key="l.name" class="repo-lang-item">
                <i class="rc-dot" :style="{ background: langColor(l.name) }"></i>
                {{ l.name }}<em>{{ l.percent.toFixed(1) }}%</em>
              </span>
            </div>
          </div>
          <p v-else-if="detailEntry && detailEntry.loading" class="repo-skel w80"></p>
          <p v-else class="repo-empty">{{ tr(secFailed('languages') ? 'github.sectionFailed' : 'github.noLanguages') }}</p>
        </section>

        <!-- 最新版本 -->
        <section class="repo-sec">
          <div class="repo-sec-head"><h4 class="repo-sec-t">{{ tr('github.latestRelease') }}</h4></div>
          <template v-if="detail && detail.release">
            <a class="repo-release" :href="detail.release.url" target="_blank" rel="noopener noreferrer">
              {{ detail.release.tag || detail.release.name }}
            </a>
            <p class="repo-sec-hint">{{ tr('github.publishedAt', { date: fmtDay(detail.release.publishedAt) }) }}</p>
          </template>
          <p v-else-if="detailEntry && detailEntry.loading" class="repo-skel w40"></p>
          <p v-else class="repo-empty">{{ tr(secFailed('release') ? 'github.sectionFailed' : 'github.noRelease') }}</p>
        </section>

        <!-- 提交历史 -->
        <section class="repo-sec">
          <div class="repo-sec-head">
            <h4 class="repo-sec-t">{{ tr('github.commits') }}</h4>
            <a class="repo-sec-link" :href="html + '/commits/' + branch" target="_blank" rel="noopener noreferrer">
              {{ tr('github.viewAllCommits') }} ↗
            </a>
          </div>
          <p class="repo-sec-hint">{{ tr('github.commitsRecent', { n: 15 }) }}</p>
          <ul v-if="detail && detail.commits.length" class="repo-commits">
            <li v-for="c in detail.commits" :key="c.sha" class="repo-commit">
              <a class="repo-commit-msg" :href="c.url" target="_blank" rel="noopener noreferrer">{{ c.message }}</a>
              <div class="repo-commit-meta">
                <img v-if="c.avatar" class="repo-commit-avatar" :src="c.avatar" :alt="c.author" loading="lazy" />
                <span class="repo-commit-author">{{ c.author }}</span>
                <span>·</span>
                <span :title="fmtDay(c.date)">{{ timeAgoText(c.date) }}</span>
                <span>·</span>
                <code class="repo-sha">{{ c.sha.slice(0, 7) }}</code>
              </div>
            </li>
          </ul>
          <p v-else-if="detailEntry && detailEntry.loading" class="repo-skel w80"></p>
          <p v-else class="repo-empty">{{ tr(secFailed('commits') ? 'github.sectionFailed' : 'github.noCommits') }}</p>
        </section>

        <section class="repo-sec">
          <div class="repo-sec-head">
            <h4 class="repo-sec-t">{{ tr('github.contributors') }}</h4>
            <span class="repo-sec-hint">{{ tr('github.contributorsHint') }}</span>
          </div>
          <div v-if="detail && detail.contributors.length" class="repo-contribs">
            <a
              v-for="c in detail.contributors"
              :key="c.login"
              class="repo-contrib"
              :href="c.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="c.login + ' · ' + tr('github.contributions', { n: c.contributions })"
            >
              <img :src="c.avatar" :alt="c.login" loading="lazy" />
            </a>
          </div>
          <p v-else-if="detailEntry && detailEntry.loading" class="repo-skel w60"></p>
          <p v-else class="repo-empty">{{ tr(secFailed('contributors') ? 'github.sectionFailed' : 'github.noContributors') }}</p>
        </section>

        <!-- 详情取不到时的说明（仓库主信息通常还在，不影响上层） -->
        <p v-if="detailEntry && detailEntry.code" class="repo-alert">{{ tr(detailEntry.code) }}</p>
        <p v-else-if="detailEntry && detailEntry.stale" class="repo-alert">{{ tr('github.stale') }}</p>
      </div>
    </div>
  </div>
</template>
