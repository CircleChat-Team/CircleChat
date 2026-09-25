<script setup lang="ts">
// 个人资料 - 第三方登录（GitHub）绑定 绑定后即可用 GitHub 一键登录；解绑后仍可用账号密码登录（永远有退路）。 是否可用取决于管理员有没有在管理面板里配好 GitHub OAuth 应用。
import { onMounted, ref } from 'vue';
import { get, post } from '../../../core/api';
import { tr } from '../../../core/i18n';
import { notify } from '../../../core/chat';

const loading = ref(true);
const enabled = ref(false); // 管理员是否配置了 GitHub 登录
const login = ref<string | null>(null); 
const busy = ref(false);

function load(): void {
  loading.value = true;
  get('/api/oauth/me')
    .then((j) => {
      const g = (j.github || {}) as { enabled?: boolean; login?: string };
      enabled.value = !!(j.ok && g.enabled);
      login.value = (j.ok && g.login) || null;
    })
    .catch(() => {
      /* 忽略：拉不到就按未开启显示 */
    })
    .then(() => {
      loading.value = false;
    });
}

onMounted(load);

/** 绑定：走一次完整跳转（GitHub 授权 → 回调 → 回到聊天页并提示结果） */
function bind(): void {
  location.href = '/api/oauth/github/start?mode=bind';
}

function unbind(): void {
  busy.value = true;
  post('/api/oauth/github/unbind', {})
    .then((j) => {
      busy.value = false;
      if (j.ok) {
        login.value = null;
        notify('profile.github.unbound', true);
      } else {
        notify(String(j.error || 'common.opFailed'));
      }
    })
    .catch(() => {
      busy.value = false;
      notify('common.opFailed');
    });
}
</script>

<template>
  <section>
    <div class="flex items-center justify-between">
      <span class="text-xs text-muted">{{ tr('profile.github.title') }}</span>
      <span
        v-if="!loading"
        class="text-xs font-medium"
        :class="login ? 'text-success' : 'text-muted'"
      >
        {{ tr(login ? 'profile.github.on' : 'profile.github.off') }}
      </span>
    </div>

    <!-- 管理员没配好 OAuth 应用时，只说明情况，不给按钮（点了也会失败） -->
    <p v-if="!loading && !enabled" class="mt-1.5 text-[11px] text-muted">
      {{ tr('profile.github.disabled') }}
    </p>

    <template v-else-if="!loading">
      <p class="mt-1.5 text-[11px] text-muted">
        {{ login ? tr('profile.github.boundAs', { login }) : tr('profile.github.hint') }}
      </p>
      <div class="mt-2 flex gap-2">
        <button
          v-if="!login"
          type="button"
          class="btn-mini"
          @click="bind"
        >{{ tr('profile.github.bind') }}</button>
        <button
          v-else
          type="button"
          class="btn-mini btn-danger"
          :disabled="busy"
          @click="unbind"
        >{{ tr('profile.github.unbind') }}</button>
      </div>
    </template>
  </section>
</template>
