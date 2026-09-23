<script setup lang="ts">
/* ============================================================
 * 个人资料 - 我的处罚 + 申诉
 *
 * 处罚数据由外壳（MyProfile）统一拉取后以 props 传入，避免重复请求；
 * 申诉数据只在这个页签打开时才需要，所以本组件自己拉。
 * 有「仍在生效」的处罚时才给申诉入口；已经有待处理的申诉就只显示进度，
 * 不让反复提交（服务端也会拦，这里只是别让人白点）。
 * ============================================================ */
import { computed, onMounted, ref } from 'vue';
import { tr } from '../../../core/i18n';
import { fmtDate } from '../../../core/format';
import { appealStatusKey, loadMyAppeals } from '../../../core/appeal';
import AppealForm from '../../common/AppealForm.vue';
import type { AppealItem, PenaltyItem } from '../../../types';

const props = defineProps<{
  penalties: PenaltyItem[];
  loading: boolean;
}>();

const appeals = ref<AppealItem[]>([]);
const appealsLoading = ref(true);
const formOpen = ref(false);

/** 仍生效的处罚（有它才谈得上申诉） */
const activePenalty = computed<PenaltyItem | null>(() => props.penalties.find((p) => p.active) || null);
/** 待处理的申诉：有它就不再给提交按钮 */
const pendingAppeal = computed<AppealItem | null>(() => appeals.value.find((a) => a.status === 'pending') || null);

function typeText(t: string): string {
  return tr('mod.type.' + t);
}

function reload(): void {
  loadMyAppeals().then((list) => {
    appeals.value = list;
    appealsLoading.value = false;
  });
}

onMounted(reload);
</script>

<template>
  <section class="flex flex-col gap-3">
    <!-- 处罚记录 -->
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

    <!-- 申诉区：有生效中的处罚才出现 -->
    <div v-if="activePenalty" class="appeal-box rounded-xl border border-line bg-fill p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[13px] font-medium">{{ tr('mod.appeal.title') }}</span>
        <button
          v-if="!pendingAppeal"
          type="button"
          class="appeal-open ml-auto shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          @click="formOpen = !formOpen"
        >{{ tr('mod.appeal.open') }}</button>
        <span v-else class="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] text-primary">
          <span class="appeal-pending">{{ tr('mod.appeal.statusPending') }}</span>
        </span>
      </div>

      <p v-if="pendingAppeal" class="mt-1.5 text-[11px] leading-relaxed text-muted">
        {{ tr('mod.appeal.pendingHint', { date: fmtDate(pendingAppeal.created) }) }}
      </p>
      <p v-else class="mt-1.5 text-[11px] leading-relaxed text-muted">{{ tr('mod.appeal.hint') }}</p>

      <div v-if="formOpen && !pendingAppeal" class="mt-2">
        <AppealForm @done="reload" />
      </div>
    </div>

    <!-- 我的申诉记录 -->
    <div v-if="!appealsLoading && appeals.length" class="flex flex-col gap-1.5">
      <p class="text-[11px] font-medium text-muted">{{ tr('mod.appeal.mine') }}</p>
      <div
        v-for="a in appeals"
        :key="a.id"
        class="rounded-xl border border-line px-3 py-2 text-[13px]"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
            :class="a.status === 'approved' ? 'bg-primary/12 text-primary' : (a.status === 'rejected' ? 'bg-fill text-danger' : 'bg-fill text-muted')"
          >{{ tr(appealStatusKey(a.status)) }}</span>
          <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ a.reason }}</span>
          <span class="shrink-0 text-[11px] text-muted">{{ fmtDate(a.created) }}</span>
        </div>
        <p v-if="a.note" class="mt-1 text-[11px] text-muted">{{ tr('mod.appeal.note') }} {{ a.note }}</p>
      </div>
    </div>
  </section>
</template>
