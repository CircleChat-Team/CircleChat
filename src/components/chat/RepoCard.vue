<script setup lang="ts">
/* ============================================================
 * 消息里的 GitHub 仓库卡片
 *
 * 数据只走一次接口：repoBasic() 按仓库共享缓存（同一条消息出现两次、
 * 反复重挂载、别人也发过同一个仓库，都只发一个请求）。
 * 点「展开详细信息」才去取详情（RepoModal），且详情不重复取仓库主信息。
 * ============================================================ */
import { computed } from 'vue';
import { openRepoView } from '../../core/chat';
import { tr } from '../../core/i18n';
import { repoBasic, formatCount, timeAgoText, langColor } from '../../core/github';

const props = defineProps<{ repo: string }>();

// 同步拿到（可能还在加载中的）缓存条目；组件被重新挂载也会复用它，不会重新请求
const entry = computed(() => repoBasic(props.repo));
const data = computed(() => entry.value.data);
</script>

<template>
  <!-- 整张卡吞掉点击：别让点卡片把消息气泡的其它行为（多选等）带出来 -->
  <div class="repo-card" @click.stop>
    <div class="rc-head">
      <span class="rc-gh" aria-hidden="true">
        <svg viewBox="0 0 16 16" class="rc-gh-icon">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
      </span>
      <span class="rc-name">{{ entry.data ? entry.data.full : repo }}</span>
      <span v-if="entry.stale" class="rc-stale">{{ tr('github.stale') }}</span>
    </div>

    <!-- 加载中 -->
    <div v-if="entry.loading && !data" class="rc-skel">
      <span class="rc-skel-line w70"></span>
      <span class="rc-skel-line w40"></span>
    </div>

    <!-- 取不到：给一行原因 + 直接去 GitHub 的链接，别让卡片变成死块 -->
    <template v-else-if="!data">
      <p class="rc-err">{{ entry.error || tr('github.failed') }}</p>
      <a class="rc-link" :href="'https://github.com/' + repo" target="_blank" rel="noopener noreferrer">
        github.com/{{ repo }} ↗
      </a>
    </template>

    <!-- 正常 -->
    <template v-else>
      <p v-if="data.description" class="rc-desc">{{ data.description }}</p>
      <div class="rc-stats">
        <span class="rc-stat" :title="tr('github.stars')">★ {{ formatCount(data.stars) }}</span>
        <span class="rc-stat" :title="tr('github.forks')">⑂ {{ formatCount(data.forks) }}</span>
        <span v-if="data.language" class="rc-stat">
          <i class="rc-dot" :style="{ background: langColor(data.language) }"></i>{{ data.language }}
        </span>
      </div>
      <div v-if="data.commit" class="rc-commit" :title="data.commit.message">
        <span class="rc-commit-msg">{{ data.commit.message }}</span>
        <span class="rc-commit-time">{{ timeAgoText(data.commit.date) }}</span>
      </div>
    </template>

    <div class="rc-actions">
      <button type="button" class="rc-btn" @click="openRepoView(repo)">{{ tr('github.expand') }}</button>
      <a
        class="rc-btn rc-btn-ghost"
        :href="data ? data.html : 'https://github.com/' + repo"
        target="_blank"
        rel="noopener noreferrer"
      >GitHub ↗</a>
    </div>
  </div>
</template>
