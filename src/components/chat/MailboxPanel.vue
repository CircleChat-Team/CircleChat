<script setup lang="ts">
/* ============================================================
 * 站内信面板：系统公告 / 通知 / 我的处罚 三个标签页
 * ============================================================ */
import { onMounted, ref } from 'vue';
import { get, post } from '../../core/api';
import { tr } from '../../core/i18n';
import { fmtDate } from '../../core/format';
import type { PenaltyItem } from '../../types';

const emit = defineEmits<{ (e: 'close'): void; (e: 'read'): void }>();

type Tab = 'announce' | 'notify' | 'penalty';
const tab = ref<Tab>('announce');

// ---- 系统公告 ----
interface Announcement { id: number; title: string; content?: string | null; actor?: string | null; created?: number | null }
const announcements = ref<Announcement[]>([]);

// ---- 通知 ----
interface NotificationItem { id: number; kind?: string | null; title?: string | null; body?: string | null; created?: number | null; read?: boolean }
const notifications = ref<NotificationItem[]>([]);

// ---- 我的处罚 ----
const penalties = ref<PenaltyItem[]>([]);
const loadingPen = ref(true);

const loading = ref(true);

function typeText(t: string): string {
  return tr('mod.type.' + t);
}

function unreadIcon(n: NotificationItem): boolean {
  return !n.read;
}

// 打开时一次性拉取三类数据
onMounted(() => {
  loading.value = true;
  Promise.all([get('/api/announcements'), get('/api/me/notifications'), get('/api/me/penalties')])
    .then(([a, n, p]) => {
    if (a && a.ok) announcements.value = (a.announcements as Announcement[]) || [];
    if (n && n.ok) notifications.value = (n.notifications as NotificationItem[]) || [];
    if (p && p.ok) {
      penalties.value = (p.penalties as PenaltyItem[]) || [];
    }
    loading.value = false;
    loadingPen.value = false;
  }).catch(() => {
    loading.value = false;
    loadingPen.value = false;
  });
});

// 进入「通知」页时若还有未读，自动标记已读并通知外部清除铃铛红点
function openTab(t: Tab): void {
  tab.value = t;
  if (t === 'notify' && notifications.value.some(unreadIcon)) markRead();
}

function markRead(): void {
  if (!notifications.value.some(unreadIcon)) return;
  void post('/api/me/notifications/read').then((j) => {
    if (j && j.ok) {
      notifications.value = notifications.value.map((x) => ({ ...x, read: true }));
      emit('read');
    }
  });
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="mailbox relative w-[24rem] max-w-full overflow-hidden rounded-2xl bg-panel text-ink shadow-xl">
      <div class="!py-4 border-b border-line px-5 text-center text-base font-semibold">
        {{ tr('mailbox.title') }}
      </div>

      <!-- 标签页 -->
      <div class="flex border-b border-line">
        <button
          type="button"
          class="flex-1 py-2 text-sm"
          :class="tab === 'announce' ? 'font-semibold text-primary' : 'text-muted'"
          @click="tab = 'announce'"
        >{{ tr('mailbox.tab.announce') }}</button>
        <button
          type="button"
          class="relative flex-1 py-2 text-sm"
          :class="tab === 'notify' ? 'font-semibold text-primary' : 'text-muted'"
          @click="openTab('notify')"
        >{{ tr('mailbox.tab.notify') }}
          <span
            v-if="notifications.some(unreadIcon)"
            class="absolute right-4 top-1.5 h-2 w-2 rounded-full bg-danger"
          ></span>
        </button>
        <button
          type="button"
          class="flex-1 py-2 text-sm"
          :class="tab === 'penalty' ? 'font-semibold text-primary' : 'text-muted'"
          @click="tab = 'penalty'"
        >{{ tr('mailbox.tab.penalty') }}</button>
      </div>

      <div class="max-h-[60vh] overflow-y-auto px-5 py-4">
        <!-- 系统公告 -->
        <div v-if="tab === 'announce'">
          <div v-if="loading" class="py-6 text-center text-xs text-muted">…</div>
          <div v-else-if="!announcements.length" class="py-6 text-center text-xs text-muted">{{ tr('mailbox.announce.empty') }}</div>
          <div v-else class="flex flex-col gap-2.5">
            <div v-for="a in announcements" :key="a.id" class="rounded-xl border border-line px-3 py-2.5 text-[13px]">
              <div class="font-medium">{{ a.title }}</div>
              <p v-if="a.content" class="mt-1 whitespace-pre-wrap text-xs text-muted">{{ a.content }}</p>
              <p class="mt-1.5 text-[11px] text-muted">{{ a.actor || '—' }} · {{ fmtDate(a.created) }}</p>
            </div>
          </div>
        </div>

        <!-- 通知 -->
        <div v-else-if="tab === 'notify'">
          <div class="mb-2 flex justify-end">
            <button type="button" class="text-xs text-primary" @click="markRead">{{ tr('mailbox.notify.readAll') }}</button>
          </div>
          <div v-if="loading" class="py-6 text-center text-xs text-muted">…</div>
          <div v-else-if="!notifications.length" class="py-6 text-center text-xs text-muted">{{ tr('mailbox.notify.empty') }}</div>
          <div v-else class="flex flex-col gap-2">
            <div
              v-for="n in notifications"
              :key="n.id"
              class="rounded-xl border px-3 py-2.5 text-[13px]"
              :class="n.read ? 'border-line' : 'border-primary/40 bg-primary/5'"
            >
              <div class="flex items-center gap-2">
                <span v-if="!n.read" class="h-2 w-2 shrink-0 rounded-full bg-danger" :title="tr('mailbox.notify.unread')"></span>
                <span class="font-medium">{{ tr(n.title || '') }}</span>
              </div>
              <p v-if="n.body" class="mt-1 text-xs text-muted">{{ n.body }}</p>
              <p class="mt-1 text-[11px] text-muted">{{ fmtDate(n.created) }}</p>
            </div>
          </div>
        </div>

        <!-- 我的处罚 -->
        <div v-else>
          <div v-if="loadingPen" class="py-6 text-center text-xs text-muted">…</div>
          <div v-else-if="!penalties.length" class="py-6 text-center text-xs text-muted">{{ tr('mod.penalties.empty') }}</div>
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
        </div>
      </div>

      <button
        type="button"
        class="absolute right-3 top-2.5 text-2xl leading-none text-muted"
        :title="tr('common.close')"
        @click="emit('close')"
      >×</button>
    </div>
  </div>
</template>