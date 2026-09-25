<script setup lang="ts">
/* ============================================================
 * 个人资料 - API Key 管理：创建（分组 scope + 限速 + 有效期）、
 * 列表、修改、吊销/恢复、删除。明文仅在创建时展示一次。
 * ============================================================ */
import { onMounted, ref } from 'vue';
import { get, post } from '../../../core/api';
import { tr } from '../../../core/i18n';
import { confirm } from '../../../core/dialog';
import { fmtDateTime } from '../../../core/format';

interface ApiKeyItem {
  id: number;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimit: number | null;
  created: number;
  lastUsed: number | null;
  expires: number | null;
  revoked: boolean;
}

const keys = ref<ApiKeyItem[]>([]);
const allScopes = ref<string[]>(['profile', 'friends', 'messages', 'groups', 'files', 'admin']);
const defaultRate = ref(60);
const isAdmin = ref(false);
const loading = ref(true);

// 新建表单
const name = ref('');
const picked = ref<string[]>(['profile']);
const rateLimit = ref<string>('');
const expiresDays = ref<string>('');
const busy = ref(false);
const err = ref('');
const createdPlaintext = ref('');

// 行内编辑
const editId = ref<number | null>(null);
const eName = ref('');
const eScopes = ref<string[]>([]);
const eRate = ref<string>('');
const eExpires = ref<string>('');

function toggle(arr: string[], v: string): void {
  const i = arr.indexOf(v);
  if (i === -1) arr.push(v);
  else arr.splice(i, 1);
}

function onToggleScope(v: string): void {
  if (v === 'admin' && !isAdmin.value) return;
  toggle(picked.value, v);
}

function load(): void {
  get('/api/keys')
    .then((j) => {
      loading.value = false;
      if (!j.ok) return;
      keys.value = (j.keys as ApiKeyItem[]) || [];
      if (Array.isArray(j.scopes) && j.scopes.length) allScopes.value = j.scopes as string[];
      if (typeof j.defaultRate === 'number') defaultRate.value = j.defaultRate;
      isAdmin.value = !!j.isAdmin;
    })
    .catch(() => {
      loading.value = false;
    });
}

function create(): void {
  err.value = '';
  createdPlaintext.value = '';
  const n = name.value.trim();
  if (!n) {
    err.value = tr('profile.apikey.nameRequired');
    return;
  }
  if (!picked.value.length) {
    err.value = tr('profile.apikey.scopeRequired');
    return;
  }
  busy.value = true;
  post('/api/keys', {
    name: n,
    scopes: picked.value.slice(),
    rateLimit: rateLimit.value ? Number(rateLimit.value) : null,
    expiresDays: expiresDays.value ? Number(expiresDays.value) : null
  }).then((j) => {
    busy.value = false;
    if (!j.ok) {
      err.value = tr(j.error || 'common.opFailed');
      return;
    }
    createdPlaintext.value = String(j.plaintext || '');
    name.value = '';
    picked.value = ['profile'];
    rateLimit.value = '';
    expiresDays.value = '';
    load();
  }).catch(() => {
    busy.value = false;
    err.value = tr('common.opFailed');
  });
}

function copy(text: string): void {
  const fallback = (): void => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* 忽略 */ }
    document.body.removeChild(ta);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallback);
  else fallback();
}

function startEdit(k: ApiKeyItem): void {
  editId.value = k.id;
  eName.value = k.name;
  eScopes.value = k.scopes.slice();
  eRate.value = k.rateLimit != null ? String(k.rateLimit) : '';
  const days = k.expires != null ? Math.max(1, Math.round((k.expires - Date.now()) / 86400000)) : 0;
  eExpires.value = days ? String(days) : '';
}

function cancelEdit(): void {
  editId.value = null;
}

function saveEdit(k: ApiKeyItem): void {
  const n = eName.value.trim();
  if (!n || !eScopes.value.length) return;
  post('/api/keys/update', {
    id: k.id,
    name: n,
    scopes: eScopes.value.slice(),
    rateLimit: eRate.value ? Number(eRate.value) : null,
    expiresDays: eExpires.value ? Number(eExpires.value) : null
  }).then((j) => {
    if (j.ok) {
      editId.value = null;
      load();
    }
  });
}

function toggleRevoke(k: ApiKeyItem): void {
  const rev = !k.revoked;
  confirm({
    title: tr(rev ? 'profile.apikey.revoke' : 'profile.apikey.restore'),
    text: tr(rev ? 'profile.apikey.revokeConfirm' : 'profile.apikey.restoreConfirm', { name: k.name }),
    okText: tr('common.ok'),
    danger: rev
  }).then((ok) => {
    if (!ok) return;
    post('/api/keys/update', { id: k.id, revoked: rev }).then(() => load());
  });
}

function remove(k: ApiKeyItem): void {
  confirm({
    title: tr('profile.apikey.delete'),
    text: tr('profile.apikey.deleteConfirm', { name: k.name }),
    okText: tr('profile.apikey.delete'),
    danger: true
  }).then((ok) => {
    if (!ok) return;
    post('/api/keys/delete', { id: k.id }).then(() => load());
  });
}

onMounted(load);
</script>

<template>
  <section class="space-y-5">
    <p class="text-xs text-muted">{{ tr('profile.apikey.desc') }}</p>

    <!-- 新建 -->
    <section class="rounded-xl border border-line bg-fill/40 p-3">
      <div class="mb-2 text-[13px] font-semibold">{{ tr('profile.apikey.create') }}</div>

      <div class="flex flex-wrap items-end gap-2">
        <div class="min-w-0 flex-1">
          <label class="mb-1 block text-xs text-muted">{{ tr('profile.apikey.name') }}</label>
          <input
            v-model="name"
            type="text"
            maxlength="40"
            class="h-9 w-full rounded-lg border border-line bg-panel px-2.5 text-sm outline-none focus:border-primary"
            :placeholder="tr('profile.apikey.namePlaceholder')"
          >
        </div>
        <div>
          <label class="mb-1 block text-xs text-muted">{{ tr('profile.apikey.rateLimit') }}</label>
          <input
            v-model="rateLimit"
            type="number"
            min="1"
            max="6000"
            class="h-9 w-24 rounded-lg border border-line bg-panel px-2.5 text-sm outline-none focus:border-primary"
            :placeholder="String(defaultRate)"
          >
        </div>
        <div>
          <label class="mb-1 block text-xs text-muted">{{ tr('profile.apikey.expires') }}</label>
          <input
            v-model="expiresDays"
            type="number"
            min="1"
            max="3650"
            class="h-9 w-24 rounded-lg border border-line bg-panel px-2.5 text-sm outline-none focus:border-primary"
            :placeholder="tr('profile.apikey.never')"
          >
        </div>
      </div>

      <div class="mt-3">
        <div class="mb-1 text-xs text-muted">{{ tr('profile.apikey.scopesLabel') }}</div>
        <div class="flex flex-wrap gap-1.5">
          <label
            v-for="s in allScopes"
            :key="s"
            class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 text-xs"
            :class="{ 'opacity-40 cursor-not-allowed': s === 'admin' && !isAdmin }"
          >
            <input
              type="checkbox"
              class="h-3.5 w-3.5 accent-primary"
              :checked="picked.indexOf(s) !== -1"
              :disabled="s === 'admin' && !isAdmin"
              @change="onToggleScope(s)"
            >
            <span>{{ tr('profile.apikey.scope.' + s) }}</span>
          </label>
        </div>
        <p class="mt-1 text-[11px] text-muted">{{ tr('profile.apikey.scopeHint') }}</p>
      </div>

      <div class="mt-3 flex items-center gap-2">
        <button
          type="button"
          class="btn-mini btn-primary"
          :disabled="busy"
          @click="create"
        >{{ tr('profile.apikey.createBtn') }}</button>
        <span v-if="err" class="text-xs text-danger">{{ err }}</span>
      </div>

      <!-- 创建后仅展示一次的明文 -->
      <div v-if="createdPlaintext" class="mt-3 rounded-lg border border-primary/40 bg-primary/8 p-2.5">
        <div class="mb-1 text-xs font-semibold text-primary">{{ tr('profile.apikey.plaintextTitle') }}</div>
        <div class="flex items-center gap-2">
          <code class="min-w-0 flex-1 select-all break-all font-mono text-xs">{{ createdPlaintext }}</code>
          <button type="button" class="btn-mini" @click="copy(createdPlaintext)">{{ tr('profile.apikey.copy') }}</button>
        </div>
        <p class="mt-1 text-[11px] text-muted">{{ tr('profile.apikey.plaintextWarn') }}</p>
      </div>
    </section>

    <!-- 列表 -->
    <section>
      <div class="mb-2 text-[13px] font-semibold">{{ tr('profile.apikey.list') }}</div>
      <p v-if="loading" class="py-2 text-center text-xs text-muted">{{ tr('common.loading') }}</p>
      <p v-else-if="!keys.length" class="py-2 text-center text-xs text-muted">{{ tr('profile.apikey.empty') }}</p>

      <div
        v-for="k in keys"
        :key="k.id"
        class="mb-2 rounded-xl border border-line bg-fill/40 p-2.5"
        :class="{ 'opacity-60': k.revoked }"
      >
        <template v-if="editId !== k.id">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-semibold">{{ k.name }}</span>
            <code class="rounded bg-panel px-1.5 py-0.5 font-mono text-[11px] text-muted">cc_{{ k.prefix }}_…</code>
            <span v-if="k.revoked" class="rounded bg-danger/12 px-1.5 py-0.5 text-[11px] text-danger">{{ tr('profile.apikey.revoked') }}</span>
            <div class="ml-auto flex items-center gap-1.5">
              <button type="button" class="btn-mini" @click="startEdit(k)">{{ tr('profile.apikey.edit') }}</button>
              <button type="button" class="btn-mini" @click="toggleRevoke(k)">
                {{ k.revoked ? tr('profile.apikey.restore') : tr('profile.apikey.revoke') }}
              </button>
              <button type="button" class="btn-mini" @click="remove(k)">{{ tr('profile.apikey.delete') }}</button>
            </div>
          </div>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              v-for="s in k.scopes"
              :key="s"
              class="rounded bg-primary/12 px-1.5 py-0.5 text-[11px] text-primary"
            >{{ tr('profile.apikey.scope.' + s) }}</span>
            <span class="text-[11px] text-muted">· {{ tr('profile.apikey.rateLabel', { n: k.rateLimit || defaultRate }) }}</span>
            <span class="text-[11px] text-muted">· {{ tr('profile.apikey.created') }} {{ fmtDateTime(k.created) }}</span>
            <span class="text-[11px] text-muted">· {{ tr('profile.apikey.lastUsed') }} {{ k.lastUsed ? fmtDateTime(k.lastUsed) : tr('profile.apikey.never') }}</span>
            <span class="text-[11px] text-muted">· {{ tr('profile.apikey.expiresAt') }} {{ k.expires ? fmtDateTime(k.expires) : tr('profile.apikey.never') }}</span>
          </div>
        </template>

        <!-- 行内编辑 -->
        <template v-else>
          <div class="flex flex-wrap items-end gap-2">
            <div class="min-w-0 flex-1">
              <label class="mb-1 block text-xs text-muted">{{ tr('profile.apikey.name') }}</label>
              <input v-model="eName" type="text" maxlength="40" class="h-8 w-full rounded-lg border border-line bg-panel px-2 text-sm outline-none focus:border-primary">
            </div>
            <div>
              <label class="mb-1 block text-xs text-muted">{{ tr('profile.apikey.rateLimit') }}</label>
              <input v-model="eRate" type="number" min="1" max="6000" class="h-8 w-20 rounded-lg border border-line bg-panel px-2 text-sm outline-none focus:border-primary" :placeholder="String(defaultRate)">
            </div>
            <div>
              <label class="mb-1 block text-xs text-muted">{{ tr('profile.apikey.expires') }}</label>
              <input v-model="eExpires" type="number" min="1" max="3650" class="h-8 w-20 rounded-lg border border-line bg-panel px-2 text-sm outline-none focus:border-primary" :placeholder="tr('profile.apikey.never')">
            </div>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <label
              v-for="s in allScopes"
              :key="s"
              class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 text-xs"
              :class="{ 'opacity-40 cursor-not-allowed': s === 'admin' && !isAdmin }"
            >
              <input type="checkbox" class="h-3.5 w-3.5 accent-primary" :checked="eScopes.indexOf(s) !== -1" :disabled="s === 'admin' && !isAdmin" @change="toggle(eScopes, s)">
              <span>{{ tr('profile.apikey.scope.' + s) }}</span>
            </label>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <button type="button" class="btn-mini btn-primary" @click="saveEdit(k)">{{ tr('profile.apikey.save') }}</button>
            <button type="button" class="btn-mini" @click="cancelEdit">{{ tr('common.cancel') }}</button>
          </div>
        </template>
      </div>
    </section>
  </section>
</template>
