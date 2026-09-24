<script setup lang="ts">
/* ============================================================
 * 我的群邀请：列出待我同意的邀请，可接受 / 拒绝。
 * ============================================================ */
import { onMounted, computed } from 'vue';
import { tr } from '../../core/i18n';
import { chatState, loadMyInvites, acceptInvite, rejectInvite, loadGroups, notify } from '../../core/chat';

const emit = defineEmits<{ close: [] }>();

const invites = computed(() => chatState.myInvites || []);

function groupName(gid: string): string {
  const g = chatState.myGroups.find((x) => x.id === gid);
  return g ? g.name : gid;
}

function accept(id: number): void {
  acceptInvite(id).then((j) => {
    if (j.ok) {
      notify(tr('group.inviteAccept'), true);
      loadMyInvites();
      loadGroups();
    }
  });
}
function reject(id: number): void {
  rejectInvite(id).then(() => loadMyInvites());
}

onMounted(() => loadMyInvites());
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="flex max-h-[80vh] w-full max-w-md flex-col rounded-card border border-line bg-panel p-4 shadow-lg">
      <header class="mb-3 flex items-center gap-2">
        <h2 class="text-sm font-semibold">{{ tr('group.myInvites') }}</h2>
        <button type="button" class="ml-auto text-lg text-muted hover:text-ink" @click="emit('close')">×</button>
      </header>

      <p v-if="!invites.length" class="py-4 text-center text-xs text-muted">{{ tr('group.inviteEmpty') }}</p>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div
          v-for="i in invites"
          :key="i.id"
          class="mb-2 flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[13px]"
        >
          <span class="min-w-0 flex-1 truncate">
            {{ tr('group.inviteFrom', { name: i.inviter }) }}
            <span class="ml-1 text-[11px] text-muted">({{ groupName(i.gid) }})</span>
          </span>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
            @click="accept(i.id)"
          >{{ tr('group.inviteAccept') }}</button>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-danger hover:text-danger"
            @click="reject(i.id)"
          >{{ tr('group.inviteReject') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
