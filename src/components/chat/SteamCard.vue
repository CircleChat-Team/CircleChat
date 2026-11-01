<script setup lang="ts">
/* ============================================================
 * 消息里的 Steam 商店游戏卡片（store.steampowered.com/app/N）
 * 数据走 core/steam.ts 的共享缓存；取不到就只留消息里的原链接。
 * ============================================================ */
import { computed } from 'vue';
import { tr } from '../../core/i18n';
import { steamApp } from '../../core/steam';

const props = defineProps<{ appid: number }>();

const entry = computed(() => steamApp(props.appid));
const data = computed(() => entry.value.data);
/** 游戏不存在 / 已下架：整张卡不画，只留原链接 */
const hidden = computed(() => !entry.value.loading && !data.value && entry.value.code === 'steam.notFound');
const href = computed(() => data.value?.html || 'https://store.steampowered.com/app/' + props.appid);
</script>

<template>
  <div v-if="!hidden" class="steam-card" @click.stop>
    <a class="steam-cover" :href="href" target="_blank" rel="noopener noreferrer">
      <img v-if="data && data.header" :src="data.header" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <span v-else class="steam-cover-skel"></span>
    </a>

    <div class="steam-body">
      <div class="steam-head">
        <span class="steam-badge">Steam</span>
        <a class="steam-name" :href="href" target="_blank" rel="noopener noreferrer" :title="data ? data.name : ''">
          {{ data ? data.name : 'App ' + appid }}
        </a>
        <span v-if="entry.stale" class="steam-stale">{{ tr('steam.stale') }}</span>
      </div>

      <div v-if="entry.loading && !data" class="steam-skel">
        <span class="steam-skel-line w80"></span>
        <span class="steam-skel-line w50"></span>
      </div>

      <template v-else-if="!data">
        <p class="steam-err">{{ tr(entry.code || 'steam.failed') }}</p>
        <a class="steam-link" :href="href" target="_blank" rel="noopener noreferrer">
          store.steampowered.com/app/{{ appid }} ↗
        </a>
      </template>

      <template v-else>
        <p v-if="data.shortDescription" class="steam-desc">{{ data.shortDescription }}</p>

        <div class="steam-meta">
          <span v-if="data.free" class="steam-price is-free">{{ tr('steam.free') }}</span>
          <span v-else-if="data.price" class="steam-price">
            <span v-if="data.discount > 0" class="steam-discount">-{{ data.discount }}%</span>
            <span class="steam-final">{{ data.price }}</span>
            <s v-if="data.discount > 0 && data.initialPrice" class="steam-initial">{{ data.initialPrice }}</s>
          </span>
          <span v-if="data.releaseDate" class="steam-date">
            {{ data.comingSoon ? tr('steam.comingSoon') : data.releaseDate }}
          </span>
          <span v-if="data.metacritic" class="steam-score">MC {{ data.metacritic }}</span>
        </div>

        <div class="steam-foot">
          <span class="steam-platforms">
            <span v-if="data.platforms.windows" title="Windows">Win</span>
            <span v-if="data.platforms.mac" title="macOS">macOS</span>
            <span v-if="data.platforms.linux" title="Linux">Linux</span>
          </span>
          <span v-if="data.genres.length" class="steam-genres" :title="data.genres.join(' · ')">
            {{ data.genres.join(' · ') }}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
