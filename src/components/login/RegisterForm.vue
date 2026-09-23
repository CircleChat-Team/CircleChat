<script setup lang="ts">
/* ============================================================
 * 注册申请表单（提交后需管理员审核）
 * ============================================================ */
import { ref } from 'vue';
import { post } from '../../core/api';
import { tr } from '../../core/i18n';
import { passwordOk } from '../../core/password';
import CaptchaField from '../common/CaptchaField.vue';

const emit = defineEmits<{ submitted: [name: string] }>();

const user = ref('');
const email = ref('');
const pass = ref('');
const pass2 = ref('');
const loading = ref(false);
const hint = ref('');

// 图形验证码（同登录页：一次性，失败后要换一张）
const captchaText = ref('');
const captcha = ref<InstanceType<typeof CaptchaField> | null>(null);
/** 管理面板里可以关掉注册页的人机验证 */
const captchaOn = ref(true);

// 简单邮箱格式校验
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function submit(): Promise<void> {
  const u = user.value.trim();
  const em = email.value.trim();
  const p = pass.value;
  hint.value = '';

  if (!u || !p) {
    hint.value = tr('login.err.empty');
    return;
  }
  if (!EMAIL_RE.test(em)) {
    hint.value = tr('reg.emailInvalid');
    return;
  }
  if (!passwordOk(p)) {
    hint.value = tr('reg.short');
    return;
  }
  if (p !== pass2.value) {
    hint.value = tr('reg.mismatch');
    return;
  }
  if (captchaOn.value && !captchaText.value.trim()) {
    hint.value = tr('login.captcha.required');
    return;
  }

  loading.value = true;
  const payload: Record<string, unknown> = { name: u, email: em, password: p };
  if (captchaOn.value) {
    payload.captchaId = captcha.value ? captcha.value.getId() : '';
    payload.captcha = captchaText.value.trim();
  }
  post('/api/register', payload)
    .then((j) => {
      loading.value = false;
      if (j.ok) {
        user.value = '';
        email.value = '';
        pass.value = '';
        pass2.value = '';
        hint.value = tr(j.message || 'reg.ok');
        emit('submitted', u); // 回填用户名并切回登录表单
        return;
      }
      hint.value = tr(j.error || 'reg.fail');
      captchaText.value = '';
      captcha.value?.refresh(); // 验证码已被这次提交消费掉
    })
    .catch(() => {
      loading.value = false;
      hint.value = tr('login.err.network');
      captchaText.value = '';
      captcha.value?.refresh();
    });
}
</script>

<template>
  <form class="mt-6 flex flex-col gap-3" autocomplete="off" @submit.prevent="submit">
    <input
      v-model="user"
      type="text"
      maxlength="20"
      required
      class="h-11 w-full rounded-xl border border-line bg-fill px-3 text-[15px] outline-none transition-colors focus:border-primary"
      :placeholder="tr('reg.userPlaceholder')"
    >
    <input
      v-model="email"
      type="email"
      maxlength="190"
      required
      class="h-11 w-full rounded-xl border border-line bg-fill px-3 text-[15px] outline-none transition-colors focus:border-primary"
      :placeholder="tr('reg.emailPlaceholder')"
    >
    <input
      v-model="pass"
      type="password"
      maxlength="64"
      required
      class="h-11 w-full rounded-xl border border-line bg-fill px-3 text-[15px] outline-none transition-colors focus:border-primary"
      :placeholder="tr('reg.passPlaceholder')"
    >
    <input
      v-model="pass2"
      type="password"
      maxlength="64"
      required
      class="h-11 w-full rounded-xl border border-line bg-fill px-3 text-[15px] outline-none transition-colors focus:border-primary"
      :placeholder="tr('reg.pass2Placeholder')"
    >

    <CaptchaField ref="captcha" v-model="captchaText" scope="register" @enabled="captchaOn = $event" />

    <button
      type="submit"
      :disabled="loading"
      class="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-[15px] font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
    >
      <span
        v-if="loading"
        class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
      />
      <span v-else>{{ tr('reg.submit') }}</span>
    </button>

    <p v-if="hint" class="text-center text-xs text-muted">{{ hint }}</p>
  </form>
</template>
