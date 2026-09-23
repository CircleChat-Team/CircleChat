<script setup lang="ts">
/* ============================================================
 * 登录安全 —— 人机验证（图形验证码）开关
 *
 * 登录页 / 注册页各一个开关，存服务端 app_config（整站级，不是用户设置）。
 * 关掉后：前端不显示验证码输入框、提交时也不带验证码字段；
 * 服务端在 /api/login、/api/register 上同样按开关跳过校验（不信任前端）。
 *
 * 说明：注册是开放接口，关掉它等于谁都能提交申请（仍要管理员审核），
 * 所以两个开关分开，别一关全关。
 * ============================================================ */
import { inject, onMounted, ref } from 'vue';
import { get, post } from '../../core/api';
import { tr } from '../../core/i18n';

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

const login = ref(true);
const register = ref(true);
const failed = ref('');
const busy = ref(false);

function load(): void {
  get('/api/admin/captcha')
    .then((j) => {
      if (!j.ok) {
        failed.value = String(j.error || 'common.loadFailed');
        return;
      }
      failed.value = '';
      login.value = j.login !== false;
      register.value = j.register !== false;
    })
    .catch(() => {
      failed.value = 'common.loadFailed';
    });
}

onMounted(load);

function save(): void {
  busy.value = true;
  post('/api/admin/captcha', { login: login.value, register: register.value })
    .then((j) => {
      busy.value = false;
      if (!j.ok) {
        toast(tr(j.error || 'common.opFailed'));
        return;
      }
      login.value = j.login !== false;
      register.value = j.register !== false;
      toast(tr('admin.captcha.saved'));
    })
    .catch(() => {
      busy.value = false;
      toast(tr('common.opFailed'));
    });
}
</script>

<template>
  <section class="rounded-card border border-line bg-panel p-4">
    <h2 class="text-[13px] font-semibold text-muted">{{ tr('admin.captcha.title') }}</h2>
    <p class="mt-1.5 text-xs text-muted">{{ tr('admin.captcha.hint') }}</p>

    <p v-if="failed" class="py-3 text-center text-xs text-muted">{{ tr(failed) }}</p>

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
          :disabled="busy"
          class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          @click="save"
        >{{ tr('common.save') }}</button>
        <span class="text-[11px] text-muted">{{ tr('admin.captcha.risk') }}</span>
      </div>
    </div>
  </section>
</template>
