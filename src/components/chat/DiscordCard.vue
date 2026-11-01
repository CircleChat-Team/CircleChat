<script setup lang="ts">
/* ============================================================
 * 消息里的 Discord 服务器邀请卡片（discord.gg/<code>）
 * 数据与图标都由服务端代理（见 server/lib/discord.ts），
 * 客户端按邀请码共享缓存；失效/非服务器邀请不画卡。
 * ============================================================ */
import { computed } from 'vue';
import { asset } from '../../core/api';
import { tr } from '../../core/i18n';
import { discordInvite } from '../../core/discord';

const props = defineProps<{ code: string }>();

const entry = computed(() => discordInvite(props.code));
const data = computed(() => entry.value.data);
const icon = computed(() => (data.value?.icon ? asset(data.value.icon) : ''));
/** 邀请失效 / 不是服务器邀请：不画卡，只留原链接 */
const hidden = computed(
  () =>
    !entry.value.loading &&
    !data.value &&
    (entry.value.code === 'discord.notFound' || entry.value.code === 'discord.notGuild')
);
</script>

<template>
  <div v-if="!hidden" class="discord-card" @click.stop>
    <div class="dc-icon">
      <img v-if="icon" :src="icon" alt="" loading="lazy" />
      <span v-else class="dc-icon-skel" aria-hidden="true">D</span>
    </div>

    <div class="dc-body">
      <div class="dc-head">
        <span class="dc-badge">Discord</span>
        <a
          v-if="data"
          class="dc-name"
          :href="data.html"
          target="_blank"
          rel="noopener noreferrer"
          :title="data.name"
        >{{ data.name }}</a>
        <span v-else class="dc-name">{{ entry.loading ? '…' : code }}</span>
        <span v-if="entry.stale" class="dc-stale">{{ tr('discord.stale') }}</span>
      </div>

      <p v-if="data && data.description" class="dc-desc">{{ data.description }}</p>
      <p v-else-if="data && data.channel" class="dc-channel">#{{ data.channel }}</p>

      <div v-if="data" class="dc-meta">
        <span class="dc-online">
          <i class="dc-dot" aria-hidden="true"></i>{{ tr('discord.online', { n: data.online }) }}
        </span>
        <span class="dc-members">{{ tr('discord.members', { n: data.members }) }}</span>
      </div>
      <p v-else-if="!entry.loading" class="dc-err">{{ tr(entry.code || 'discord.failed') }}</p>

      <div class="dc-actions">
        <a
          class="dc-join"
          :href="'https://discord.gg/' + code"
          target="_blank"
          rel="noopener noreferrer"
        >{{ tr('discord.join') }}</a>
      </div>
    </div>
  </div>
</template>
