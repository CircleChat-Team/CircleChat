<script setup lang="ts">
/* ============================================================
 * 第三方登录配置（GitHub OAuth）
 *
 * client_id / client_secret 由管理员在这里填，存在服务端 app_config 表里。
 * secret 只用于服务端换取 access_token，接口从不回传（只回报「是否已设置」）。
 * 面板会把回调地址显示出来——它必须与 GitHub 应用里的 Callback URL 完全一致。
 * ============================================================ */
import { inject, onMounted, ref } from 'vue';
import { get, post } from '../../core/api';
import { tr } from '../../core/i18n';

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

const clientId = ref('');
const secret = ref('');
const hasSecret = ref(false);
const redirectUri = ref('');
const failed = ref('');
const busy = ref(false);

function load(): void {
  get('/api/admin/oauth')
    .then((j) => {
      if (!j.ok) {
        failed.value = String(j.error || 'common.loadFailed');
        return;
      }
      failed.value = '';
      const g = (j.github || {}) as { clientId?: string; hasSecret?: boolean; redirectUri?: string };
      clientId.value = g.clientId || '';
      hasSecret.value = !!g.hasSecret;
      redirectUri.value = g.redirectUri || '';
      secret.value = '';
    })
    .catch(() => {
      failed.value = 'common.loadFailed';
    });
}

onMounted(load);

function save(): void {
  busy.value = true;
  post('/api/admin/oauth', { clientId: clientId.value.trim(), secret: secret.value.trim() })
    .then((j) => {
      busy.value = false;
      if (!j.ok) {
        toast(tr(j.error || 'common.opFailed'));
        return;
      }
      toast(tr('admin.oauth.saved'));
      load();
    })
    .catch(() => {
      busy.value = false;
      toast(tr('common.opFailed'));
    });
}

function clearAll(): void {
  busy.value = true;
  post('/api/admin/oauth', { clear: true })
    .then((j) => {
      busy.value = false;
      toast(tr(j.ok ? 'admin.oauth.cleared' : (j.error || 'common.opFailed')));
      if (j.ok) load();
    })
    .catch(() => {
      busy.value = false;
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
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="mb-1 text-[13px] font-semibold text-muted">{{ tr('admin.oauth.title') }}</h2>
    <p class="mb-3 text-[11px] leading-relaxed text-muted">{{ tr('admin.oauth.tip') }}</p>

    <p v-if="failed" class="py-2.5 text-center text-xs text-muted">{{ tr(failed) }}</p>

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
          <button type="button" class="btn-mini" :disabled="busy" @click="save">{{ tr('common.save') }}</button>
          <button type="button" class="btn-mini btn-danger" :disabled="busy" @click="clearAll">{{ tr('admin.oauth.clear') }}</button>
        </div>
      </div>
    </template>
  </section>
</template>
