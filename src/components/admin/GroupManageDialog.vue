<script setup lang="ts">
/* ============================================================
 * 管理面板 · 群管理弹窗
 * 复用群本身的管理接口（/api/groups/manage）：管理员对这些群拥有与群主同等的权限，
 * 所以这里直接取成员列表，并提供重命名 / 解散两个动作。
 * Esc / 点遮罩关闭；确认框走 core/dialog，叠在上面时 Esc 只关它。
 * ============================================================ */
import { computed, inject, ref, watch } from 'vue';
import { get, post, del } from '../../core/api';
import { tr, trn } from '../../core/i18n';
import { confirm, prompt } from '../../core/dialog';
import { fmtDate } from '../../core/format';
import { copyToClipboard } from '../../core/chat';
import { useOverlay } from '../../core/useOverlay';
import type { GroupItem, GroupMember } from '../../types';

const props = defineProps<{ group: GroupItem | null }>();
const emit = defineEmits<{ close: []; changed: [] }>();

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

const rootEl = ref<HTMLElement | null>(null);
const members = ref<GroupMember[]>([]);
const loading = ref(false);

useOverlay({
  isOpen: () => !!props.group,
  onClose: () => emit('close'),
  container: () => rootEl.value
});

watch(
  () => props.group && props.group.id,
  (gid) => {
    members.value = [];
    if (!gid) return;
    loading.value = true;
    get('/api/groups/manage?gid=' + encodeURIComponent(String(gid)))
      .then((j) => {
        loading.value = false;
        if (!j.ok) {
          toast(tr(j.error || 'common.loadFailed'));
          return;
        }
        members.value = (j.members as GroupMember[]) || [];
      })
      .catch(() => {
        loading.value = false;
        toast(tr('common.loadFailed'));
      });
  },
  { immediate: true }
);

const created = computed(() => (props.group && props.group.created ? fmtDate(props.group.created) : ''));

function copyGid(): void {
  if (props.group) copyToClipboard(props.group.id);
  toast(tr('group.gidCopied'));
}

function rename(): void {
  const g = props.group;
  if (!g) return;
  prompt({
    title: tr('group.renameTitle'),
    text: tr('group.renamePrompt'),
    okText: tr('group.renameOk'),
    input: { type: 'text', placeholder: g.name, maxLength: 24 }
  }).then((v) => {
    if (v == null) return;
    const name = v.trim();
    if (!name || name === g.name) return;
    post('/api/groups/rename', { gid: g.id, name }).then((j) => {
      toast(j.ok ? tr('group.renamed') : tr(j.error || 'common.opFailed'));
      if (!j.ok) return;
      emit('changed');
    });
  });
}

function dissolve(): void {
  const g = props.group;
  if (!g) return;
  confirm({
    title: tr('group.delete'),
    text: tr('group.deleteConfirm'),
    okText: tr('group.delete')
  }).then((ok) => {
    if (!ok) return;
    del('/api/groups', { gid: g.id }).then((j) => {
      toast(j.ok ? tr('group.deleted') : tr(j.error || 'common.opFailed'));
      if (!j.ok) return;
      emit('changed');
      emit('close');
    });
  });
}

function roleTag(m: GroupMember): string {
  if (m.owner) return tr('group.ownerTag');
  if (m.role === 'admin') return tr('group.roleAdmin');
  return '';
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="group"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="emit('close')"
    >
      <div
        ref="rootEl"
        class="flex max-h-[86vh] w-[min(460px,100%)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-(--shadow-pop)"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex items-start gap-3 border-b border-line px-5 py-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="min-w-0 truncate text-[15px] font-semibold">{{ group.name }}</span>
              <span v-if="group.muteAll" class="shrink-0 text-[11px] text-warn">{{ tr('group.muteAll') }}</span>
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
              <span>{{ tr('group.owner', { name: group.owner }) }}</span>
              <span v-if="created">{{ created }}</span>
              <button
                type="button"
                class="rounded-md px-1 text-[11px] text-primary transition-colors hover:bg-fill"
                :title="tr('group.copyGid')"
                @click="copyGid"
              >{{ tr('group.gid') }} · {{ tr('group.copyGid') }}</button>
            </div>
          </div>

          <button
            type="button"
            class="shrink-0 text-2xl leading-none text-muted transition-colors hover:text-ink"
            :title="tr('common.close')"
            :aria-label="tr('common.close')"
            @click="emit('close')"
          >×</button>
        </div>

        <!-- 操作：竖排整行按钮 -->
        <div class="flex flex-col gap-1.5 border-b border-line p-4">
          <button
            type="button"
            class="w-full rounded-xl border border-line bg-fill px-3 py-2 text-left text-[13px] transition-colors hover:border-primary hover:text-primary"
            @click="rename"
          >{{ tr('group.rename') }}</button>
          <button
            type="button"
            class="w-full rounded-xl border border-line bg-fill px-3 py-2 text-left text-[13px] transition-colors hover:border-danger hover:text-danger"
            @click="dissolve"
          >{{ tr('group.delete') }}</button>
        </div>

        <!-- 成员列表 -->
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <h3 class="mb-2 text-[12px] font-semibold text-muted">
            {{ tr('group.members') }}
            <span class="font-normal">{{ trn('admin.count.groupMembers', members.length) }}</span>
          </h3>
          <p v-if="loading" class="py-2 text-center text-xs text-muted">…</p>
          <p v-else-if="!members.length" class="py-2 text-center text-xs text-muted">
            {{ tr('group.membersEmpty') }}
          </p>
          <div v-else class="flex flex-col gap-1">
            <div
              v-for="m in members"
              :key="m.name"
              class="flex items-center gap-2 rounded-xl bg-fill px-2.5 py-1.5 text-[12px]"
            >
              <span class="min-w-0 flex-1 truncate">{{ m.name }}</span>
              <span v-if="roleTag(m)" class="shrink-0 text-[11px] text-primary">{{ roleTag(m) }}</span>
              <span v-if="m.muted" class="shrink-0 text-[11px] text-danger">{{ tr('group.memberMuted') }}</span>
              <span class="shrink-0 text-[11px] text-muted">{{ fmtDate(m.joined) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
