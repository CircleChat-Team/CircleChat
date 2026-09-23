<script setup lang="ts">
/* ============================================================
 * 处罚申诉表单（登录页与个人资料共用）
 *
 * 两处用法差别只在「要不要重新证明身份」：
 *   - 登录页（被封禁的人进不来）：needCredentials，要填用户名 + 密码
 *   - 个人资料（已登录的禁言 / 警告）：不用密码，服务端按会话认人
 * 提交结果就地反馈，不发全局 toast —— 登录页没有 toast 容器。
 * ============================================================ */
import { ref } from 'vue';
import { tr } from '../../core/i18n';
import { submitAppeal } from '../../core/appeal';

const props = defineProps<{
  /** 是否要求填用户名 + 密码（未登录时） */
  needCredentials?: boolean;
  /** 用户名预填（登录页把输入框里的值带过来） */
  initialUser?: string;
}>();
const emit = defineEmits<{ done: [] }>();

const username = ref(props.initialUser || '');
const password = ref('');
const reason = ref('');
const busy = ref(false);
/** 提示文案键；成功时是 success 键 */
const tipKey = ref('');
const tipOk = ref(false);

function submit(): void {
  if (busy.value) return;
  if (reason.value.trim().length < 3) {
    tipKey.value = 'mod.appeal.reasonTooShort';
    tipOk.value = false;
    return;
  }
  if (props.needCredentials && (!username.value.trim() || !password.value)) {
    tipKey.value = 'mod.appeal.needCredentials';
    tipOk.value = false;
    return;
  }
  busy.value = true;
  tipKey.value = '';
  submitAppeal(reason.value, props.needCredentials ? { username: username.value, password: password.value } : null)
    .then((j) => {
      busy.value = false;
      if (!j.ok) {
        tipKey.value = j.error || 'common.opFailed';
        tipOk.value = false;
        return;
      }
      tipOk.value = true;
      tipKey.value = 'mod.appeal.submitted';
      reason.value = '';
      password.value = '';
      emit('done');
    })
    .catch(() => {
      busy.value = false;
      tipKey.value = 'common.opFailed';
      tipOk.value = false;
    });
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <template v-if="needCredentials">
      <input
        v-model="username"
        type="text"
        maxlength="64"
        autocomplete="username"
        class="appeal-input h-9 rounded-lg border border-line bg-fill px-2.5 text-[13px] outline-none transition-colors focus:border-primary"
        :placeholder="tr('login.username')"
      >
      <input
        v-model="password"
        type="password"
        maxlength="128"
        autocomplete="current-password"
        class="appeal-input h-9 rounded-lg border border-line bg-fill px-2.5 text-[13px] outline-none transition-colors focus:border-primary"
        :placeholder="tr('login.password')"
      >
    </template>

    <textarea
      v-model="reason"
      rows="3"
      maxlength="500"
      class="appeal-input w-full resize-none rounded-lg border border-line bg-fill px-2.5 py-2 text-[13px] leading-relaxed outline-none transition-colors focus:border-primary"
      :placeholder="tr('mod.appeal.reasonPlaceholder')"
    ></textarea>

    <div class="flex items-center gap-2">
      <p v-if="tipKey" class="min-w-0 flex-1 text-[11px] leading-relaxed" :class="tipOk ? 'text-primary' : 'text-danger'">
        {{ tr(tipKey) }}
      </p>
      <span v-else class="min-w-0 flex-1" />
      <button
        type="button"
        class="appeal-submit h-8 shrink-0 rounded-lg bg-primary px-3.5 text-[13px] text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
        :disabled="busy"
        @click="submit"
      >{{ tr('mod.appeal.submit') }}</button>
    </div>
  </div>
</template>
