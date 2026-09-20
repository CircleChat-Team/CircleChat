<script setup lang="ts">
/* ============================================================
 * 个人资料 - 两步验证块：开启 / 关闭 / 绑定
 * ============================================================ */
import { onMounted, ref, nextTick } from 'vue';
import { get } from '../../../core/api';
import { tr } from '../../../core/i18n';
import { encodeQr } from '../../../lib/qrcode';
import { twofaSetup, twofaEnable, twofaDisable, copyToClipboard } from '../../../core/chat';

const totpEnabled = ref(false);
const loadingStatus = ref(true);

const secret = ref('');
const otpauth = ref('');
const code = ref('');
const twofaMsg = ref('');
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
  twofaEnable(code.value).then((j) => {
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
    twofaMsg.value = tr('common.opFailedRetry');
  });
}
function doDisable(): void {
  twofaMsg.value = '';
  twofaDisable(code.value).then((j) => {
    if (j.ok) {
      totpEnabled.value = false;
      code.value = '';
      twofaMsg.value = tr('twofa.disabled');
    } else {
      twofaMsg.value = tr(j.error || 'twofa.badCode');
    }
  }).catch(() => {
    twofaMsg.value = tr('common.opFailedRetry');
  });
}
function copy(s: string): void {
  copyToClipboard(s);
}

onMounted(() => {
  get('/api/me').then((j) => {
    if (j && j.ok) totpEnabled.value = !!j.totpEnabled;
    loadingStatus.value = false;
  }).catch(() => {
    loadingStatus.value = false;
  });
});
</script>

<template>
  <section>
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
        <button type="button" class="btn-mini btn-danger" @click="doDisable">{{ tr('twofa.disable') }}</button>
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
        <button type="button" class="btn-mini" @click="verifyEnable">{{ tr('twofa.verify') }}</button>
      </div>
    </template>

    <p v-if="twofaMsg" class="mt-1 text-xs text-danger">{{ twofaMsg }}</p>
  </section>
</template>