<script setup lang="ts">
/* ============================================================
 * 合并转发查看器：以模态框展示一条 merge 消息内的多条内容
 * ============================================================ */
import { computed } from 'vue';
import { chatState, closeMergeView, asset, fmtSize } from '../../core/chat';
import { tr } from '../../core/i18n';
import TextContent from './TextContent.vue';

const view = computed(() => chatState.mergeView);
</script>

<template>
  <div v-if="view" class="merge-mask" @click.self="closeMergeView">
    <div class="merge-modal">
      <div class="merge-mhead">
        <span class="merge-mtitle">{{ view.title || tr('chat.merge.label') }}</span>
        <button type="button" class="merge-x" @click="closeMergeView">×</button>
      </div>
      <div class="merge-mbody">
        <div v-for="(it, i) in view.items" :key="i" class="merge-item">
          <div class="merge-item-from">{{ it.from }}</div>
          <div class="merge-item-main">
            <img v-if="it.type === 'image'" class="merge-item-img" :src="asset(it.content || '')" alt="" loading="lazy" />
            <video
              v-else-if="it.type === 'video'"
              class="merge-item-img"
              :src="asset(it.content || '')"
              controls
              preload="metadata"
            ></video>
            <a
              v-else-if="it.type === 'file' || it.type === 'audio'"
              class="merge-item-file"
              :href="asset(it.content || '')"
              target="_blank"
              rel="noopener"
            >{{ it.type === 'audio' ? '🎵' : '📎' }} {{ it.name || tr('chat.file.defaultName') }}<span v-if="it.size"> · {{ fmtSize(it.size) }}</span></a>
            <div v-else class="merge-item-text">
              <TextContent :text="it.content || ''" md />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
