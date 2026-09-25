<script setup lang="ts">
// 个人资料 - 修改密码块
import { ref } from 'vue';
import { post } from '../../../core/api';
import { tr } from '../../../core/i18n';
import { logout } from '../../../core/chat';

const curPass = ref('');
const newPass = ref('');
const confirmPass = ref('');
const passMsg = ref('');
/** true = 成功提示（绿色）；用文案内容判断是否成功在英文/日文下会误判 */
const passOk = ref(false);

function savePassword(): void {
  if (!curPass.value || !newPass.value) {
    passMsg.value = tr('login.err.empty');
    return;
  }
  if (newPass.value !== confirmPass.value) {
    passMsg.value = tr('profile.password.mismatch');
    return;
  }
  passMsg.value = '';
  // 复用 /api/pass（与强制改密同一套：校验当前密码 + 强度）
  post('/api/pass', { current: curPass.value, password: newPass.value })
    .then((j) => {
    if (j.ok) {
      // 改密后服务端已销毁全部会话：提示后回登录页重新登录
      passOk.value = true;
      passMsg.value = tr('pass.changedRelogin');
      curPass.value = '';
      newPass.value = '';
      confirmPass.value = '';
      window.setTimeout(() => logout(), 1500);
    } else {
      passOk.value = false;
      passMsg.value = tr(j.error || 'common.opFailed');
    }
  }).catch(() => {
    passMsg.value = tr('common.opFailedRetry');
  });
}
</script>

<template>
  <section>
    <div class="mb-1.5 text-xs text-muted">{{ tr('profile.password.label') }}</div>
    <input
      v-model="curPass"
      type="password"
      autocomplete="current-password"
      :aria-label="tr('profile.password.current')"
      class="mb-2 h-9 w-full rounded-lg border border-line bg-fill px-2.5 text-sm outline-none focus:border-primary"
      :placeholder="tr('profile.password.current')"
    >
    <input
      v-model="newPass"
      type="password"
      autocomplete="new-password"
      class="mb-2 h-9 w-full rounded-lg border border-line bg-fill px-2.5 text-sm outline-none focus:border-primary"
      :placeholder="tr('profile.password.new')"
    >
    <input
      v-model="confirmPass"
      type="password"
      autocomplete="new-password"
      class="h-9 w-full rounded-lg border border-line bg-fill px-2.5 text-sm outline-none focus:border-primary"
      :placeholder="tr('profile.password.confirm')"
    >
    <p v-if="passMsg" class="mt-1 text-xs" :class="passOk ? 'text-success' : 'text-danger'">{{ passMsg }}</p>
    <button type="button" class="btn-mini mt-2" @click="savePassword">{{ tr('profile.password.save') }}</button>
    <p class="mt-1 text-[11px] text-muted">{{ tr('profile.password.short') }}</p>
  </section>
</template>