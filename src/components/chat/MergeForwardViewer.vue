<script setup lang="ts">
// 合并转发查看器：以模态框展示一条 merge 消息内的多条内容
import { computed, ref } from 'vue';
import type { MergeItem } from '../../types';
import { chatState, closeMergeView, asset, fmtSize } from '../../core/chat';
import { tr } from '../../core/i18n';
import { mediaKind } from '../../core/media';
import { useOverlay } from '../../core/useOverlay';
import TextContent from './TextContent.vue';
import AudioPlayer from './AudioPlayer.vue';
import VideoPlayer from './VideoPlayer.vue';

const view = computed(() => chatState.mergeView);

/** 与聊天区一致：媒体类型优先，type='file' 时按扩展名兜底（兼容 .mkv 等历史数据） */
function kindOf(it: MergeItem): 'video' | 'audio' | 'other' {
  return mediaKind(it.type, it.name);
}

// Esc 关闭 + 打开时聚焦弹层 + 关闭后归还焦点
const rootEl = ref<HTMLElement | null>(null);
useOverlay({
  isOpen: () => !!view.value,
  onClose: closeMergeView,
  container: () => rootEl.value
});
</script>

<template>
  <div v-if="view" ref="rootEl" class="merge-mask" @click.self="closeMergeView">
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
            <VideoPlayer
              v-else-if="kindOf(it) === 'video'"
              :src="asset(it.content || '')"
              :name="it.name"
              :size="it.size"
            />
            <AudioPlayer
              v-else-if="kindOf(it) === 'audio'"
              :src="asset(it.content || '')"
              :name="it.name || ''"
              :size="it.size"
            />
            <a
              v-else-if="it.type === 'file'"
              class="merge-item-file"
              :href="asset(it.content || '')"
              target="_blank"
              rel="noopener"
            >📎 {{ it.name || tr('chat.file.defaultName') }}<span v-if="it.size"> · {{ fmtSize(it.size) }}</span></a>
            <div v-else class="merge-item-text">
              <TextContent :text="it.content || ''" md hide-repos />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
