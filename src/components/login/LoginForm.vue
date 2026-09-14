<script setup lang="ts">
/* ============================================================
 * 登录表单
 * ============================================================ */
import { ref } from 'vue';
import { post } from '../../core/api';
import { tr } from '../../core/i18n';
import { redirectAfterLogin } from '../../core/nav';
import ForceChangePassword from '../common/ForceChangePassword.vue';

const props = defineProps<{ initialUser?: string }>();

const user = ref(props.initialUser || '');
const pass = ref('');
const showPass = ref(false);
const loading = ref(false);
const err = ref('');
const pendingForce = ref(false);

async function submit(): Promise<void> {
  const u = user.value.trim();
  if (!u || !pass.value) {
    err.value = tr('login.err.empty');
    return;
  }
  err.value = '';
  loading.value = true;
  post('/api/login', { username: u, password: pass.value })
    .then((j) => {
      if (j.ok) {
        if (j.mustChange) {
          // 首次登录仍需强制改密，弹窗拦截
          pendingForce.value = true;
          loading.value = false;
          return;
        }
        redirectAfterLogin();
        return;
      }
      loading.value = false;
      // error 既可能是 i18n 键，也可能是服务端直出的中文；
      // I18N.t 对未知键原样返回，两种情况都能正确显示
      err.value = tr(j.error || 'login.err.failed');
    })
    .catch(() => {
      loading.value = false;
      err.value = tr('login.err.network');
    });
}
</script>

<template>
  <form class="mt-6 flex flex-col gap-3" autocomplete="off" @submit.prevent="submit">
    <input
      v-model="user"
      type="text"
      maxlength="32"
      required
      class="h-11 w-full rounded-xl border border-line bg-fill px-3 text-[15px] outline-none transition-colors focus:border-primary"
      :placeholder="tr('login.userPlaceholder')"
    >

    <div class="relative">
      <input
        v-model="pass"
        :type="showPass ? 'text' : 'password'"
        maxlength="64"
        required
        class="h-11 w-full rounded-xl border border-line bg-fill pl-3 pr-11 text-[15px] outline-none transition-colors focus:border-primary"
        :placeholder="tr('login.passPlaceholder')"
      >
      <button
        type="button"
        class="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition-colors hover:text-ink"
        :title="showPass ? tr('login.hidePass') : tr('login.showPass')"
        :aria-label="tr('login.togglePass')"
        @click="showPass = !showPass"
      >
        <svg v-if="showPass" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
          />
        </svg>
        <svg v-else class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2z"
          />
        </svg>
      </button>
    </div>

    <button
      type="submit"
      :disabled="loading"
      class="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-[15px] font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
    >
      <span
        v-if="loading"
        class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
      />
      <span v-else>{{ tr('login.submit') }}</span>
    </button>

    <p v-if="err" class="text-center text-xs text-danger">{{ err }}</p>
  </form>

  <ForceChangePassword v-if="pendingForce" :username="user" forced @done="redirectAfterLogin" />
</template>
