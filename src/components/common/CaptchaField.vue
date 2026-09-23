<script setup lang="ts">
/* ============================================================
 * 图形验证码输入（登录 / 注册共用）
 *
 * 用法：
 *   <CaptchaField ref="cap" v-model="code" />
 *   提交时带 { captchaId: cap.getId(), captcha: code }
 * 服务端生成的验证码是**一次性**的：任何一次提交（无论对错）都会消费掉它，
 * 所以提交失败后父组件要调 refresh() 换一张，否则用户怎么输都是「已过期」。
 * ============================================================ */
import { computed, onMounted, ref, watch } from 'vue';
import { get } from '../../core/api';
import { tr } from '../../core/i18n';
import { theme } from '../../core/theme';

const props = defineProps<{ modelValue: string; scope?: 'login' | 'register' }>();
const emit = defineEmits<{ 'update:modelValue': [string]; enabled: [boolean] }>();

const id = ref('');
const svg = ref('');
const failed = ref(false);
/** 该页面是否开启人机验证（管理员在管理面板控制；关掉时整个控件都不渲染） */
const on = ref(true);

/** SVG 走 data URI 给 <img>，不用 v-html（不给模板注入留任何口子） */
const dataUri = computed(() =>
  svg.value ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.value) : ''
);

/** 重新取一张（点击图片、提交失败、切换主题时都要用） */
function refresh(): void {
  get('/api/captcha?scope=' + (props.scope || 'login') + '&dark=' + (theme.value === 'dark' ? '1' : '0'))
    .then((j) => {
      // 管理员把这一页的人机验证关了：不渲染输入框，父组件也不用带验证码提交
      if (j.ok && j.enabled === false) {
        on.value = false;
        id.value = '';
        svg.value = '';
        emit('enabled', false);
        emit('update:modelValue', '');
        return;
      }
      if (!j.ok || !j.svg) {
        failed.value = true;
        return;
      }
      failed.value = false;
      on.value = true;
      emit('enabled', true);
      id.value = String(j.id || '');
      svg.value = String(j.svg);
      emit('update:modelValue', '');
    })
    .catch(() => {
      failed.value = true;
    });
}

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}

// 验证码图的配色跟主题走，所以换主题要重新取一张
watch(theme, refresh);
onMounted(refresh);

defineExpose({ getId: (): string => (on.value ? id.value : ''), refresh });
</script>

<template>
  <div v-if="on" class="captcha-field flex items-stretch gap-2">
    <input
      :value="props.modelValue"
      type="text"
      maxlength="6"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      class="captcha-input h-11 min-w-0 flex-1 rounded-xl border border-line bg-fill px-3 text-[15px] tracking-widest outline-none transition-colors focus:border-primary"
      :placeholder="tr('login.captcha.placeholder')"
      @input="onInput"
    >
    <button
      type="button"
      class="captcha-btn h-11 w-[132px] shrink-0 overflow-hidden rounded-xl border border-line bg-fill transition-colors hover:border-primary"
      :title="tr('login.captcha.refresh')"
      :aria-label="tr('login.captcha.refresh')"
      @click="refresh"
    >
      <img v-if="dataUri" :src="dataUri" alt="" class="captcha-img h-full w-full">
      <span v-else class="text-[11px] text-muted">{{ tr('login.captcha.refresh') }}</span>
    </button>
  </div>
</template>
