<script setup lang="ts">
/* ============================================================
 * 登录页根组件
 * 登录 / 注册申请两种模式切换，右上角为语言与主题工具。
 * ============================================================ */
import { ref, watchEffect, onMounted } from 'vue';
import { tr } from './core/i18n';
import { get, displayBase } from './core/api';
import LangMenu from './components/common/LangMenu.vue';
import ThemeToggle from './components/common/ThemeToggle.vue';
import LoginForm from './components/login/LoginForm.vue';
import RegisterForm from './components/login/RegisterForm.vue';
import AppFooter from './components/common/AppFooter.vue';
import DownloadClient from './components/common/DownloadClient.vue';
import AppealForm from './components/common/AppealForm.vue';

type Mode = 'login' | 'register';

const mode = ref<Mode>('login');
const user = ref('');
/** 登录页的常驻申诉入口（不一定要先试一次登录） */
const appealOpen = ref(false);

// 内置管理员仍用默认密码时，登录页提示（便于不看 README 的人）
const defaultAdmin = ref<string | null>(null);
onMounted(() => {
  get('/api/setup')
    .then((j) => { defaultAdmin.value = j.ok && typeof j.defaultAdmin === 'string' ? j.defaultAdmin : null; })
    .catch(() => { defaultAdmin.value = null; });
});

// tr 是响应式的，切语言时页签标题自动更新
watchEffect(() => {
  document.title = tr('login.title');
});

function toggleMode(): void {
  mode.value = mode.value === 'login' ? 'register' : 'login';
}

/** 注册申请提交成功：回填用户名并切回登录，方便审核通过后直接登录 */
function onRegistered(name: string): void {
  user.value = name;
  mode.value = 'login';
}
</script>

<template>
  <!-- 纵向 flex：卡片用 my-auto 垂直居中，页脚在正常文档流里。
       内容变高时 auto 外边距自动归零、页脚随之下移，不会像 absolute 贴底那样压住卡片 -->
  <div class="flex min-h-screen flex-col items-center bg-bg px-4 py-8">
    <!-- 登录页无顶栏，主题与语言切换独立悬浮 -->
    <div class="fixed right-4 top-4 flex items-center gap-1">
      <ThemeToggle />
      <LangMenu />
    </div>

    <div class="my-auto w-full max-w-105 rounded-2xl border border-line bg-panel p-7 shadow-lg">
      <div class="text-center">
        <h1 class="text-2xl font-semibold tracking-tight">CircleChat</h1>
        <p class="mt-1 text-xs text-muted">{{ tr('login.tag') }}</p>
        <p class="mt-0.5 text-xs text-muted">{{ tr('login.sub') }}</p>
        <div
          v-if="defaultAdmin"
          class="mt-3 rounded-lg border border-line bg-fill px-3 py-2 text-left text-[11px] leading-relaxed text-muted"
        >
          {{ tr('login.defaultAdmin', { pw: defaultAdmin }) }}
        </div>
      </div>

      <LoginForm v-if="mode === 'login'" :initial-user="user" />
      <RegisterForm v-else @submitted="onRegistered" />

      <button
        type="button"
        class="mt-4 w-full text-center text-xs text-primary transition-opacity hover:opacity-80"
        @click="toggleMode"
      >
        {{ tr(mode === 'login' ? 'reg.toggle' : 'reg.back') }}
      </button>

      <!-- 申诉入口：被封禁的人登不进来，得在登录页就能提交（要用户名 + 密码证明身份） -->
      <div class="mt-3">
        <button
          type="button"
          class="appeal-link w-full text-center text-xs text-muted transition-colors hover:text-ink"
          @click="appealOpen = !appealOpen"
        >{{ tr('mod.appeal.entry') }}</button>
        <div v-if="appealOpen" class="appeal-box mt-2 rounded-xl border border-line bg-fill p-3">
          <p class="mb-2 text-[11px] leading-relaxed text-muted">{{ tr('mod.appeal.loginHint') }}</p>
          <AppealForm need-credentials />
        </div>
      </div>

      <!-- 桌面客户端里不显示（见组件内判断） -->
      <DownloadClient />

      <p class="mt-5 text-center text-[11px] text-muted">{{ tr('login.footer', { url: displayBase() }) }}</p>
    </div>

    <!-- 页面底部版权与项目地址（正常文档流，随内容下移，不再贴视口底部） -->
    <AppFooter />
  </div>
</template>
