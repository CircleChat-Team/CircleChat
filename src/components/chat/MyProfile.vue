<script setup lang="ts">
/* ============================================================
 * 个人资料（自编辑弹窗）：头像 / 名称 / 密码 / 两步验证
 * ============================================================ */
import { onMounted, ref, computed, nextTick } from 'vue';
import { get, post } from '../../core/api';
import { tr } from '../../core/i18n';
import { encodeQr } from '../../lib/qrcode';
import {
  chatState,
  closeMyProfile,
  avatarFor,
  avatarColor,
  updateProfileName,
  updateAvatar,
  clearAvatar,
  twofaSetup,
  twofaEnable,
  twofaDisable,
  copyToClipboard,
  logout
} from '../../core/chat';
import { useOverlay } from '../../core/useOverlay';

const initial = (n: string): string => (n || '?').slice(0, 1);
const avatarSrc = computed(() => avatarFor(chatState.me));

// Esc 关闭 + 打开时聚焦弹层 + 关闭后归还焦点
const rootEl = ref<HTMLElement | null>(null);
useOverlay({
  isOpen: () => chatState.myProfileOpen,
  onClose: closeMyProfile,
  container: () => rootEl.value
});

// ---- 2FA 状态（打开时从 /api/me 拉取） ----
const totpEnabled = ref(false);
const loadingStatus = ref(true);

// ---- 头像 ----
const avatarMsg = ref('');
const uploading = ref(false);

// ---- 名称 ----
const newName = ref(chatState.me || '');
const nameMsg = ref('');
const saveNameBusy = ref(false);

// ---- 密码 ----
const curPass = ref('');
const newPass = ref('');
const confirmPass = ref('');
const passMsg = ref('');
/** true = 成功提示（绿色）；用文案内容判断是否成功在英文/日文下会误判 */
const passOk = ref(false);
const savePassBusy = ref(false);

// ---- 2FA 流程 ----
const secret = ref('');
const otpauth = ref('');
const code = ref('');
const twofaMsg = ref('');
const twofaBusy = ref(false);
const setupStep = ref(false);
const qrCanvas = ref<HTMLCanvasElement | null>(null);

function renderQr(text: string): void {
  const cv = qrCanvas.value;
  if (!cv) return;
  let qr;
  try { qr = encodeQr(text, 'M'); } catch { return; }
  const quiet = 4;
  const scale = 6;
  const px = (qr.size + quiet * 2) * scale;
  cv.width = px;
  cv.height = px;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
  }
}

onMounted(() => {
  get('/api/me').then((j) => {
    if (j && j.ok) totpEnabled.value = !!j.totpEnabled;
    loadingStatus.value = false;
  }).catch(() => {
    loadingStatus.value = false;
  });
});

function onPickAvatar(e: Event): void {
  const file = (e.target as HTMLInputElement).files && (e.target as HTMLInputElement).files![0];
  if (!file) return;
  uploading.value = true;
  avatarMsg.value = '';
  updateAvatar(file).then((ok) => {
    uploading.value = false;
    avatarMsg.value = ok ? tr('profile.avatar.updated') : tr('common.opFailed');
    (e.target as HTMLInputElement).value = '';
  });
}
function onClearAvatar(): void {
  avatarMsg.value = '';
  clearAvatar().then((ok) => {
    avatarMsg.value = ok ? tr('profile.avatar.updated') : tr('common.opFailed');
  });
}

function saveName(): void {
  const name = newName.value.trim();
  if (!name || name === chatState.me) {
    nameMsg.value = '';
    return;
  }
  saveNameBusy.value = true;
  nameMsg.value = '';
  updateProfileName(name).then((j) => {
    saveNameBusy.value = false;
    if (j.ok) {
      nameMsg.value = tr('profile.name.changed');
      setTimeout(() => location.reload(), 1200);
    } else {
      nameMsg.value = tr(j.error || 'common.opFailed');
    }
  }).catch(() => {
    saveNameBusy.value = false;
    nameMsg.value = tr('common.opFailedRetry');
  });
}

function savePassword(): void {
  if (!curPass.value || !newPass.value) {
    passMsg.value = tr('login.err.empty');
    return;
  }
  if (newPass.value !== confirmPass.value) {
    passMsg.value = tr('profile.password.mismatch');
    return;
  }
  savePassBusy.value = true;
  passMsg.value = '';
  // 复用 /api/pass（与强制改密同一套：校验当前密码 + 强度）
  post('/api/pass', { current: curPass.value, password: newPass.value })
    .then((j) => {
    savePassBusy.value = false;
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
    savePassBusy.value = false;
    passMsg.value = tr('common.opFailedRetry');
  });
}

function startSetup(): void {
  setupStep.value = true;
  twofaMsg.value = '';
  twofaSetup().then((j) => {
    if (j.ok && j.secret) {
      secret.value = j.secret;
      otpauth.value = j.otpauth || '';
      nextTick(() => renderQr(otpauth.value));
    } else {
      setupStep.value = false;
      twofaMsg.value = tr(j.error || 'common.opFailed');
    }
  }).catch(() => {
    setupStep.value = false;
    twofaMsg.value = tr('common.opFailedRetry');
  });
}
function verifyEnable(): void {
  twofaMsg.value = '';
  twofaBusy.value = true;
  twofaEnable(code.value).then((j) => {
    twofaBusy.value = false;
    if (j.ok) {
      totpEnabled.value = true;
      setupStep.value = false;
      code.value = '';
      secret.value = '';
      otpauth.value = '';
      twofaMsg.value = tr('twofa.enabled');
    } else {
      twofaMsg.value = tr(j.error || 'twofa.badCode');
    }
  }).catch(() => {
    twofaBusy.value = false;
    twofaMsg.value = tr('common.opFailedRetry');
  });
}
function doDisable(): void {
  twofaMsg.value = '';
  twofaBusy.value = true;
  twofaDisable(code.value).then((j) => {
    twofaBusy.value = false;
    if (j.ok) {
      totpEnabled.value = false;
      code.value = '';
      twofaMsg.value = tr('twofa.disabled');
    } else {
      twofaMsg.value = tr(j.error || 'twofa.badCode');
    }
  }).catch(() => {
    twofaBusy.value = false;
    twofaMsg.value = tr('common.opFailedRetry');
  });
}
function copy(s: string): void {
  copyToClipboard(s);
}
</script>

<template>
  <div
    v-if="chatState.myProfileOpen"
    ref="rootEl"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="closeMyProfile"
  >
    <div class="myprofile relative w-[22rem] max-w-full overflow-hidden rounded-2xl bg-panel text-ink shadow-xl">
      <div class="!py-4 border-b border-line px-5 text-center text-base font-semibold">
        {{ tr('profile.title') }}
      </div>

      <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
        <!-- 头像 -->
        <section>
          <div class="mb-1.5 text-xs text-muted">{{ tr('profile.avatar.label') }}</div>
          <div class="flex items-center gap-3">
            <div class="h-16 w-16 shrink-0 overflow-hidden rounded-full">
              <img v-if="avatarSrc" :src="avatarSrc!" :alt="chatState.me" class="h-full w-full object-cover" />
              <div v-else class="flex h-full w-full items-center justify-center text-2xl font-semibold text-white" :style="{ background: avatarColor(chatState.me) }">
                {{ initial(chatState.me) }}
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <label class="btn-mini cursor-pointer">
                <span>{{ uploading ? '…' : tr('profile.avatar.change') }}</span>
                <input type="file" accept="image/*" class="hidden" @change="onPickAvatar" />
              </label>
              <button v-if="avatarSrc" type="button" class="btn-mini btn-ghost" @click="onClearAvatar">{{ tr('profile.avatar.clear') }}</button>
            </div>
          </div>
          <p v-if="avatarMsg" class="mt-1 text-xs text-success">{{ avatarMsg }}</p>
        </section>

        <!-- 名称 -->
        <section class="mt-5">
          <div class="mb-1.5 text-xs text-muted">{{ tr('profile.name.label') }}</div>
          <div class="flex gap-2">
            <input
              v-model="newName"
              type="text"
              maxlength="20"
              autocomplete="username"
              :aria-label="tr('profile.name.placeholder')"
              class="h-9 flex-1 rounded-lg border border-line bg-fill px-2.5 text-sm outline-none focus:border-primary"
              :placeholder="tr('profile.name.placeholder')"
            >
            <button type="button" class="btn-mini" :disabled="saveNameBusy" @click="saveName">{{ tr('profile.name.save') }}</button>
          </div>
          <p v-if="nameMsg" class="mt-1 text-xs text-danger">{{ nameMsg }}</p>
        </section>

        <!-- 修改密码 -->
        <section class="mt-5">
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
          <button type="button" class="btn-mini mt-2" :disabled="savePassBusy" @click="savePassword">{{ tr('profile.password.save') }}</button>
          <p class="mt-1 text-[11px] text-muted">{{ tr('profile.password.short') }}</p>
        </section>

        <!-- 两步验证 -->
        <section class="mt-5">
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted">{{ tr('twofa.label') }}</span>
            <span v-if="!loadingStatus" class="text-xs font-medium" :class="totpEnabled ? 'text-success' : 'text-muted'">
              {{ tr(totpEnabled ? 'twofa.on' : 'twofa.off') }}
            </span>
          </div>

          <template v-if="!loadingStatus && !totpEnabled && !setupStep">
            <button type="button" class="btn-mini mt-2" @click="startSetup">{{ tr('twofa.enable') }}</button>
          </template>

          <template v-else-if="!loadingStatus && totpEnabled">
            <p class="mt-1.5 text-[11px] text-muted">{{ tr('twofa.disableHint') }}</p>
            <div class="mt-2 flex gap-2">
              <input
                v-model="code"
                inputmode="numeric"
                maxlength="6"
                class="h-9 w-32 rounded-lg border border-line bg-fill px-2.5 text-sm outline-none focus:border-primary"
                :placeholder="tr('twofa.code.placeholder')"
              >
              <button type="button" class="btn-mini btn-danger" :disabled="twofaBusy" @click="doDisable">{{ tr('twofa.disable') }}</button>
            </div>
          </template>

          <template v-if="setupStep">
            <p class="mt-2 whitespace-pre-line text-[11px] text-muted">{{ tr('twofa.setupHint') }}</p>
            <div v-if="otpauth" class="mt-2 flex justify-center rounded-lg border border-line bg-white p-2">
              <canvas ref="qrCanvas" class="block" style="width: 160px; height: 160px;" />
            </div>
            <div class="mt-2 space-y-2">
              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-muted">{{ tr('twofa.secret') }}</span>
                  <button type="button" class="btn-mini btn-ghost !h-6 !px-2 text-[11px]" @click="copy(secret)">{{ tr('common.copy') }}</button>
                </div>
                <div class="mt-1 break-all rounded-lg border border-line bg-fill px-2.5 py-2 font-mono text-xs">{{ secret }}</div>
              </div>
              <div v-if="otpauth">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-muted">{{ tr('twofa.otpauth') }}</span>
                  <button type="button" class="btn-mini btn-ghost !h-6 !px-2 text-[11px]" @click="copy(otpauth)">{{ tr('common.copy') }}</button>
                </div>
                <a :href="otpauth" class="mt-1 block break-all text-xs text-primary underline">{{ otpauth }}</a>
              </div>
            </div>
            <div class="mt-2 flex gap-2">
              <input
                v-model="code"
                inputmode="numeric"
                maxlength="6"
                class="h-9 w-32 rounded-lg border border-line bg-fill px-2.5 text-sm outline-none focus:border-primary"
                :placeholder="tr('twofa.code.placeholder')"
              >
              <button type="button" class="btn-mini" :disabled="twofaBusy" @click="verifyEnable">{{ tr('twofa.verify') }}</button>
            </div>
          </template>

          <p v-if="twofaMsg" class="mt-1 text-xs text-danger">{{ twofaMsg }}</p>
        </section>
      </div>

      <button
        type="button"
        class="absolute right-3 top-2.5 text-2xl leading-none text-muted"
        :title="tr('common.close')"
        @click="closeMyProfile"
      >×</button>
    </div>
  </div>
</template>