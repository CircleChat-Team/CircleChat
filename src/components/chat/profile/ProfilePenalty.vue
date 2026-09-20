<script setup lang="ts">
/* ============================================================
 * 个人资料 - 我的处罚展示块：处罚记录列表（状态徽标由外壳身份卡负责）
 * 数据由外壳统一拉取后以 props 传入，避免重复请求。
 * ============================================================ */
import { tr } from '../../../core/i18n';
import { fmtDate } from '../../../core/format';
import type { PenaltyItem } from '../../../types';

defineProps<{
  penalties: PenaltyItem[];
  loading: boolean;
}>();

function typeText(t: string): string {
  return tr('mod.type.' + t);
}
</script>

<template>
  <section>
    <div v-if="loading" class="py-2 text-center text-xs text-muted">…</div>
    <div v-else-if="!penalties.length" class="py-2 text-center text-xs text-muted">{{ tr('mod.penalties.empty') }}</div>
    <div v-else class="flex flex-col gap-1.5">
      <div
        v-for="p in penalties"
        :key="p.id"
        class="rounded-xl border border-line px-3 py-2 text-[13px]"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="shrink-0 rounded px-1.5 py-0.5 text-[11px]" :class="p.active ? 'bg-primary/12 text-primary' : 'bg-fill text-muted'">
            {{ typeText(p.type) }}
          </span>
          <span v-if="p.permanent" class="shrink-0 text-[11px] text-danger">{{ tr('mod.permanent') }}</span>
          <span v-else-if="p.expires" class="shrink-0 text-xs text-muted">{{ tr('mod.until', { date: fmtDate(p.expires) }) }}</span>
          <span v-if="!p.active" class="shrink-0 text-[11px] text-muted">{{ tr('mod.inactive') }}</span>
        </div>
        <p v-if="p.reason" class="mt-1 text-xs text-muted">{{ tr('mod.reason') }} {{ p.reason }}</p>
        <p class="mt-1 text-[11px] text-muted">{{ tr('mod.actor') }} {{ p.actor || '—' }} · {{ fmtDate(p.created) }}</p>
      </div>
    </div>
  </section>
</template>