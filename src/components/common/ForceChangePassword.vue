<script setup lang="ts">
/* ============================================================
 * 强制改密弹窗（登录后或被强制改密时）
 * - 校验当前密码后修改；成功后 emit('done')
 * ============================================================ */
import { ref } from 'vue';
import { post } from '../../core/api';
import { tr } from '../../core/i18n';

const props = defineProps<{ username: string; forced?: boolean }>();
const emit = defineEmits<{ done: [] }>();

const current = ref('');
const np = ref('');
const confirm = ref('');
const showPass = ref(false);
const loading = ref(false);
const err = ref('');

function submit(): void {
  if (np.value.length < 6) {
    err.value = tr('reg.short');
    return;
  }
  if (np.value !== confirm.value) {
    err.value = tr('pass.mismatch');
    return;
  }
  err.value = '';
  loading.value = true;
  post('/api/pass', { current: current.value, password: np.value })
    .then((j) => {
      loading.value = false;
      if (j.ok) {
        emit('done');
        return;
      }
      // error 可能是 i18n 键或直出文案，tr 对未知键原样返回
      err.value = tr(j.error || 'common.opFailed');
    })
    .catch(() => {
      loading.value = false;
      err.value = tr('common.opFailed');
    });
}
</script>

<template>
  <div class="fixed inset-0 z-60 flex items-center justify-center bg-black/40 px-4">
    <div class="w-full max-w-105 rounded-2xl border border-line bg-panel p-6 shadow-xl">
      <h2 class="text-lg font-semibold">{{ tr('pass.forceTitle') }}</h2>
      <p v-if="forced" class="mt-1 text-xs text-muted">{{ tr('pass.forceHint') }}</p>

      <form class="mt-4 flex flex-col gap-3" autocomplete="off" @submit.prevent="submit">
        <input
          v-model="current"
          :type="showPass ? 'text' : 'password'"
          maxlength="64"
          required
          class="h-11 w-full rounded-xl border border-line bg-fill px-3 text-[15px] outline-none transition-colors focus:border-primary"
          :placeholder="tr('pass.current')"
        >
        <input
          v-model="np"
          :type="showPass ? 'text' : 'password'"
          maxlength="64"
          required
          class="h-11 w-full rounded-xl border border-line bg-fill px-3 text-[15px] outline-none transition-colors focus:border-primary"
          :placeholder="tr('pass.new')"
        >
        <input
          v-model="confirm"
          :type="showPass ? 'text' : 'password'"
          maxlength="64"
          required
          class="h-11 w-full rounded-xl border border-line bg-fill px-3 text-[15px] outline-none transition-colors focus:border-primary"
          :placeholder="tr('pass.confirm')"
        >
        <label class="flex items-center gap-2 text-xs text-muted">
          <input v-model="showPass" type="checkbox" class="accent-primary">
          {{ tr('login.showPass') }}
        </label>

        <button
          type="submit"
          :disabled="loading"
          class="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-[15px] font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          <span
            v-if="loading"
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
          <span v-else>{{ tr('pass.submit') }}</span>
        </button>

        <p v-if="err" class="text-center text-xs text-danger">{{ err }}</p>
      </form>
    </div>
  </div>
</template>
