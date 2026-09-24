<script setup lang="ts">
/* ============================================================
 * 登录安全 —— 人机验证（图形验证码）开关 + 第三方登录（GitHub OAuth）
 *
 * 两块都是整站级配置，存在服务端 app_config 表里，由管理员在这里维护。
 * - 验证码：登录页 / 注册页各一个开关。关掉后前端不显示、提交不带、服务端也跳过校验（不信任前端）。
 * - 第三方登录：GitHub OAuth 的 client_id / client_secret。secret 只用于服务端换取
 *   access_token，接口从不回传（只回报「是否已设置」）。
 * ============================================================ */
import { inject, onMounted, ref } from 'vue';
import { get, post } from '../../core/api';
import { tr } from '../../core/i18n';

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

// ---------------- 人机验证（图形验证码） ----------------
const login = ref(true);
const register = ref(true);
const capFailed = ref('');
const capBusy = ref(false);

// ---------------- 第三方登录（GitHub OAuth） ----------------
const clientId = ref('');
const secret = ref('');
const hasSecret = ref(false);
const redirectUri = ref('');
const oaFailed = ref('');
const oaBusy = ref(false);

function load(): void {
  get('/api/admin/captcha')
    .then((j) => {
      if (!j.ok) {
        capFailed.value = String(j.error || 'common.loadFailed');
        return;
      }
      capFailed.value = '';
      login.value = j.login !== false;
      register.value = j.register !== false;
    })
    .catch(() => {
      capFailed.value = 'common.loadFailed';
    });

  get('/api/admin/oauth')
    .then((j) => {
      if (!j.ok) {
        oaFailed.value = String(j.error || 'common.loadFailed');
        return;
      }
      oaFailed.value = '';
      const g = (j.github || {}) as { clientId?: string; hasSecret?: boolean; redirectUri?: string };
      clientId.value = g.clientId || '';
      hasSecret.value = !!g.hasSecret;
      redirectUri.value = g.redirectUri || '';
      secret.value = '';
    })
    .catch(() => {
      oaFailed.value = 'common.loadFailed';
    });
}

onMounted(load);

// ---------------- 验证码保存 ----------------
function saveCaptcha(): void {
  capBusy.value = true;
  post('/api/admin/captcha', { login: login.value, register: register.value })
    .then((j) => {
      capBusy.value = false;
      if (!j.ok) {
        toast(tr(j.error || 'common.opFailed'));
        return;
      }
      login.value = j.login !== false;
      register.value = j.register !== false;
      toast(tr('admin.captcha.saved'));
    })
    .catch(() => {
      capBusy.value = false;
      toast(tr('common.opFailed'));
    });
}

// ---------------- 第三方登录保存 / 清空 ----------------
function saveOauth(): void {
  oaBusy.value = true;
  post('/api/admin/oauth', { clientId: clientId.value.trim(), secret: secret.value.trim() })
    .then((j) => {
      oaBusy.value = false;
      if (!j.ok) {
        toast(tr(j.error || 'common.opFailed'));
        return;
      }
      toast(tr('admin.oauth.saved'));
      load();
    })
    .catch(() => {
      oaBusy.value = false;
      toast(tr('common.opFailed'));
    });
}

function clearOauth(): void {
  oaBusy.value = true;
  post('/api/admin/oauth', { clear: true })
    .then((j) => {
      oaBusy.value = false;
      toast(tr(j.ok ? 'admin.oauth.cleared' : (j.error || 'common.opFailed')));
      if (j.ok) load();
    })
    .catch(() => {
      oaBusy.value = false;
      toast(tr('common.opFailed'));
    });
}

function copyRedirect(): void {
  try {
    void navigator.clipboard.writeText(redirectUri.value);
    toast(tr('common.copied'), 1200);
  } catch {
    /* 剪贴板不可用时忽略 */
  }
}
</script>

<template>
  <!-- 人机验证 -->
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="text-[13px] font-semibold text-muted">{{ tr('admin.captcha.title') }}</h2>
    <p class="mt-1.5 text-xs text-muted">{{ tr('admin.captcha.hint') }}</p>

    <p v-if="capFailed" class="py-3 text-center text-xs text-muted">{{ tr(capFailed) }}</p>

    <div v-else class="mt-3 flex flex-col gap-2">
      <label class="flex cursor-pointer items-center gap-2 rounded-xl bg-fill px-3 py-2.5 text-sm">
        <input v-model="login" type="checkbox" class="h-4 w-4 accent-primary">
        <span>{{ tr('admin.captcha.login') }}</span>
      </label>
      <label class="flex cursor-pointer items-center gap-2 rounded-xl bg-fill px-3 py-2.5 text-sm">
        <input v-model="register" type="checkbox" class="h-4 w-4 accent-primary">
        <span>{{ tr('admin.captcha.register') }}</span>
      </label>

      <div class="mt-1 flex items-center gap-2">
        <button
          type="button"
          :disabled="capBusy"
          class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          @click="saveCaptcha"
        >{{ tr('common.save') }}</button>
        <span class="text-[11px] text-muted">{{ tr('admin.captcha.risk') }}</span>
      </div>
    </div>
  </section>

  <!-- 第三方登录 -->
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-1 text-[13px] font-semibold text-muted">{{ tr('admin.oauth.title') }}</h2>
    <p class="mb-3 text-[11px] leading-relaxed text-muted">{{ tr('admin.oauth.tip') }}</p>

    <p v-if="oaFailed" class="py-2.5 text-center text-xs text-muted">{{ tr(oaFailed) }}</p>

    <template v-else>
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-muted">Client ID</span>
          <input
            v-model="clientId"
            type="text"
            maxlength="64"
            spellcheck="false"
            class="h-9 rounded-lg border border-line bg-fill px-2.5 font-mono text-xs outline-none focus:border-primary"
            placeholder="Iv1.xxxxxxxxxxxxxxxx"
          >
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-muted">Client Secret</span>
          <input
            v-model="secret"
            type="password"
            maxlength="128"
            spellcheck="false"
            autocomplete="new-password"
            class="h-9 rounded-lg border border-line bg-fill px-2.5 font-mono text-xs outline-none focus:border-primary"
            :placeholder="hasSecret ? tr('admin.oauth.secretSet') : '••••••••••••••••'"
          >
        </label>

        <div v-if="redirectUri">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-muted">{{ tr('admin.oauth.redirect') }}</span>
            <button
              type="button"
              class="btn-mini btn-ghost !h-6 !px-2 text-[11px]"
              @click="copyRedirect"
            >{{ tr('common.copy') }}</button>
          </div>
          <div class="mt-1 break-all rounded-lg border border-line bg-fill px-2.5 py-2 font-mono text-[11px]">{{ redirectUri }}</div>
          <p class="mt-1 text-[11px] text-muted">{{ tr('admin.oauth.redirectTip') }}</p>
        </div>

        <div class="flex gap-2">
          <button type="button" class="btn-mini" :disabled="oaBusy" @click="saveOauth">{{ tr('common.save') }}</button>
          <button type="button" class="btn-mini btn-danger" :disabled="oaBusy" @click="clearOauth">{{ tr('admin.oauth.clear') }}</button>
        </div>
      </div>
    </template>
  </section>
</template>
