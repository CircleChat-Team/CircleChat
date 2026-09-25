<script setup lang="ts">
// 登录表单
import { computed, ref, onMounted } from 'vue';
import { get, post } from '../../core/api';
import { tr } from '../../core/i18n';
import { redirectAfterLogin } from '../../core/nav';
import ForceChangePassword from '../common/ForceChangePassword.vue';
import CaptchaField from '../common/CaptchaField.vue';
import AppealForm from '../common/AppealForm.vue';

const props = defineProps<{ initialUser?: string }>();

const user = ref(props.initialUser || '');
const pass = ref('');
const showPass = ref(false);
const loading = ref(false);
const err = ref('');
/** 保留服务端给的原始错误键：用来判断「是不是因为被封禁才登不进来」 */
const errKey = ref('');
/** 封禁提示下方的申诉表单是否展开 */
const appealOpen = ref(false);

// 图形验证码：值在父组件，id 在子组件里（提交时取）
const captchaText = ref('');
const captcha = ref<InstanceType<typeof CaptchaField> | null>(null);
/** 管理面板里可以关掉登录页的人机验证：关掉后不校验、也不提交验证码字段 */
const captchaOn = ref(true);
/** 提交失败后换一张：验证码是一次性的，被消费掉的那个再用只会一直报「已过期」 */
function refreshCaptcha(): void {
  captchaText.value = '';
  captcha.value?.refresh();
}

// 是否显示入口取决于管理员是否在管理面板里配好了 OAuth 应用
const githubOn = ref(false);

onMounted(() => {
  get('/api/oauth/providers')
    .then((j) => {
      const g = (j.github || {}) as { enabled?: boolean };
      githubOn.value = !!(j.ok && g.enabled);
    })
    .catch(() => { githubOn.value = false; });
  // 从 /api/oauth/github/callback 跳回来时带的结果码（?oauth=xxx）
  const KNOWN = ['notconfigured', 'state', 'denied', 'failed', 'nobind', 'taken', 'blocked', 'banned', '2fa'];
  const code = new URLSearchParams(location.search).get('oauth');
  if (code && code !== 'bound') {
    err.value = tr('oauth.err.' + (KNOWN.indexOf(code) !== -1 ? code : 'failed'));
  }
  if (code) history.replaceState(null, '', location.pathname); 
});
const pendingForce = ref(false);
const need2fa = ref(false);
const challenge = ref('');
const code = ref('');
const loading2fa = ref(false);
const twofaErr = ref('');

async function submit(): Promise<void> {
  const u = user.value.trim();
  if (!u || !pass.value) {
    err.value = tr('login.err.empty');
    return;
  }
  if (captchaOn.value && !captchaText.value.trim()) {
    err.value = tr('login.captcha.required');
    return;
  }
  err.value = '';
  loading.value = true;
  const payload: Record<string, unknown> = { username: u, password: pass.value };
  if (captchaOn.value) {
    payload.captchaId = captcha.value ? captcha.value.getId() : '';
    payload.captcha = captchaText.value.trim();
  }
  post('/api/login', payload)
    .then((j) => {
      if (j.ok) {
        // 已开启两步验证：先保存挑战，展示验证码输入
        if (j.need2fa) {
          challenge.value = String(j.challenge || '');
          need2fa.value = true;
          loading.value = false;
          return;
        }
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
      errKey.value = String(j.error || '');
      err.value = tr(j.error || 'login.err.failed');
      refreshCaptcha(); 
    })
    .catch(() => {
      loading.value = false;
      err.value = tr('login.err.network');
      refreshCaptcha();
    });
}

async function verify2fa(): Promise<void> {
  const c = code.value.trim();
  if (!/^\d{6}$/.test(c)) {
    twofaErr.value = tr('twofa.badCode');
    return;
  }
  twofaErr.value = '';
  loading2fa.value = true;
  post('/api/twofa/verify', { challenge: challenge.value, code: c })
    .then((j) => {
      if (j.ok) {
        if (j.mustChange) {
          pendingForce.value = true;
          loading2fa.value = false;
          return;
        }
        redirectAfterLogin();
        return;
      }
      loading2fa.value = false;
      twofaErr.value = tr(j.error || 'twofa.badCode');
      if (j.error === 'twofa.challengeExpired') {
        need2fa.value = false;
        err.value = tr('twofa.challengeExpired');
      }
    })
    .catch(() => {
      loading2fa.value = false;
      twofaErr.value = tr('login.err.network');
    });
}
/** 登不进来是因为被封禁（封号 / IP 封号）——这时才需要引导申诉 */
const isBannedErr = computed(() => errKey.value === 'api.login.banned' || errKey.value === 'api.login.ipBanned');

function backToLogin(): void {
  need2fa.value = false;
  twofaErr.value = '';
  code.value = '';
}
</script>

<template>
  <form v-if="!need2fa" class="mt-6 flex flex-col gap-3" autocomplete="off" @submit.prevent="submit">
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

    <CaptchaField ref="captcha" v-model="captchaText" scope="login" @enabled="captchaOn = $event" />

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

    <!-- 被封禁的人根本登不进来，这里就近给一个申诉入口（用户名已填好） -->
    <template v-if="isBannedErr">
      <button
        type="button"
        class="appeal-inline text-center text-xs text-primary transition-opacity hover:opacity-80"
        @click="appealOpen = !appealOpen"
      >{{ tr('mod.appeal.open') }}</button>
      <div v-if="appealOpen" class="appeal-box rounded-xl border border-line bg-fill p-3">
        <p class="mb-2 text-[11px] leading-relaxed text-muted">{{ tr('mod.appeal.loginHint') }}</p>
        <AppealForm need-credentials :initial-user="user" />
      </div>
    </template>

    <!-- 第三方登录：仅管理员在管理面板配好 GitHub OAuth 后才显示 -->
    <template v-if="githubOn">
      <div class="flex items-center gap-3 text-[11px] text-muted">
        <span class="h-px flex-1 bg-line"></span>
        <span>{{ tr('login.oauth.or') }}</span>
        <span class="h-px flex-1 bg-line"></span>
      </div>
      <a
        href="/api/oauth/github/start?mode=login"
        class="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-panel text-[15px] font-medium text-ink transition-colors hover:bg-fill"
      >
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
        </svg>
        <span>{{ tr('login.oauth.github') }}</span>
      </a>
    </template>
  </form>

  <!-- 两步验证：账号密码正确后输入动态验证码 -->
  <div v-else class="mt-6 flex flex-col gap-3">
    <div class="text-center text-sm font-medium">{{ tr('login.twofa.title') }}</div>
    <p class="text-center text-xs text-muted">{{ tr('login.twofa.hint') }}</p>
    <input
      v-model="code"
      inputmode="numeric"
      autocomplete="one-time-code"
      maxlength="6"
      class="h-11 w-full rounded-xl border border-line bg-fill px-3 text-center text-[15px] tracking-widest outline-none transition-colors focus:border-primary"
      :placeholder="tr('login.twofa.placeholder')"
      @keyup.enter="verify2fa"
    >
    <button
      type="button"
      :disabled="loading2fa"
      class="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-[15px] font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
      @click="verify2fa"
    >
      <span
        v-if="loading2fa"
        class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
      />
      <span v-else>{{ tr('login.twofa.submit') }}</span>
    </button>
    <button
      type="button"
      class="text-center text-xs text-muted transition-colors hover:text-ink"
      @click="backToLogin"
    >{{ tr('login.twofa.back') }}</button>
    <p v-if="twofaErr" class="text-center text-xs text-danger">{{ twofaErr }}</p>
  </div>

  <ForceChangePassword v-if="pendingForce" :username="user" forced @done="redirectAfterLogin" />
</template>
