<script setup lang="ts">
/* ============================================================
 * 个人资料 - 名称编辑块：改名
 * ============================================================ */
import { ref } from 'vue';
import { tr } from '../../../core/i18n';
import { chatState, updateProfileName } from '../../../core/chat';

const newName = ref(chatState.me || '');
const nameMsg = ref('');

function saveName(): void {
  const name = newName.value.trim();
  if (!name || name === chatState.me) {
    nameMsg.value = '';
    return;
  }
  updateProfileName(name).then((j) => {
    if (j.ok) {
      nameMsg.value = tr('profile.name.changed');
      setTimeout(() => location.reload(), 1200);
    } else {
      nameMsg.value = tr(j.error || 'common.opFailed');
    }
  }).catch(() => {
    nameMsg.value = tr('common.opFailedRetry');
  });
}
</script>

<template>
  <section>
    <div class="mb-1.5 text-xs text-muted">{{ tr('profile.name.label') }}</div>
    <div class="flex gap-2">
      <input
        v-model="newName"
        type="text"
        maxlength="20"
        autocomplete="username"
        :aria-label="tr('profile.name.placeholder')"
        class="h-9 flex-1 rounded-lg border border-line bg-fill px-2.5 text-sm outline-none focus:border-primary"
        :placeholder="tr('profile.name.placeholder')"
      >
      <button type="button" class="btn-mini" @click="saveName">{{ tr('profile.name.save') }}</button>
    </div>
    <p v-if="nameMsg" class="mt-1 text-xs text-danger">{{ nameMsg }}</p>
  </section>
</template>