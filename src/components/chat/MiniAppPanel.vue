<script setup lang="ts">
/* ============================================================
 * 小程序面板：已安装 / 商店 / 详情与授权
 * 安装时展示 manifest 声明的权限，用户勾选后才写入授权记录。
 * ============================================================ */
import { computed, ref, watch } from 'vue';
import { asset } from '../../core/api';
import { confirm } from '../../core/dialog';
import { tr } from '../../core/i18n';
import { useOverlay } from '../../core/useOverlay';
import { chatState } from '../../core/chat';
import {
  closeMiniPanel,
  installMiniApp,
  loadMiniIndex,
  miniState,
  openMiniApp,
  openMiniDetail,
  regrantMiniApp,
  setMiniTab,
  uninstallMiniApp,
  type MiniAppItem,
  type MiniInstallItem
} from '../../core/mini';

const rootEl = ref<HTMLElement | null>(null);
const keyword = ref('');
/** 详情页里勾选的权限（默认勾选 manifest 声明的全部） */
const granted = ref<string[]>([]);
const busy = ref(false);
/** 详情页来自「重新授权」时，指向那条已安装记录 */
const detailFromInstall = ref<MiniInstallItem | null>(null);

const inGroup = computed(() => chatState.activeGid != null);

const storeApps = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return miniState.apps;
  return miniState.apps.filter((a) =>
    (a.name + ' ' + a.summary + ' ' + a.id).toLowerCase().indexOf(k) !== -1
  );
});

const installed = computed(() => miniState.installs);
const failedSources = computed(() => miniState.sources.filter((s) => s.enabled && !s.ok));

useOverlay({
  isOpen: () => miniState.panelOpen,
  onClose: closeMiniPanel,
  container: () => rootEl.value
});

watch(
  () => miniState.detailApp,
  (app) => {
    granted.value = app ? [...app.permissions] : [];
  },
  { immediate: true }
);

function scopeLabel(i: MiniInstallItem): string {
  return i.scopeType === 'group' ? tr('mini.scope.group') : tr('mini.scope.user');
}

function permText(p: string): string {
  return tr('mini.perm.' + p);
}

function togglePerm(p: string): void {
  const i = granted.value.indexOf(p);
  if (i === -1) granted.value.push(p);
  else granted.value.splice(i, 1);
}

function install(app: MiniAppItem, scope: 'user' | 'group'): void {
  if (busy.value) return;
  busy.value = true;
  const list = granted.value.length ? [...granted.value] : [...app.permissions];
  void installMiniApp(app, scope, list)
    .then((ok) => {
      if (ok) setMiniTab('installed');
    })
    .then(() => {
      busy.value = false;
    });
}

function openInstalled(i: MiniInstallItem): void {
  void openMiniApp(i);
}

async function remove(i: MiniInstallItem): Promise<void> {
  const ok = await confirm({
    title: tr('mini.confirm.uninstall.title'),
    text: tr('mini.confirm.uninstall.text', { name: i.name }),
    okText: tr('mini.uninstall'),
    cancelText: tr('common.cancel'),
    danger: true
  });
  if (ok) void uninstallMiniApp(i);
}

function regrant(i: MiniInstallItem): void {
  miniState.detailApp = null;
  granted.value = [...i.granted];
  // 复用详情页做重新授权：以已装记录为基础构造一个 app 视图
  detailFromInstall.value = i;
  setMiniTab('detail');
}

const detail = computed<MiniAppItem | null>(() => {
  if (detailFromInstall.value) {
    const i = detailFromInstall.value;
    return {
      id: i.appId, name: i.name, summary: i.summary, description: i.description,
      icon: i.icon, version: i.version, entry: i.entry, permissions: i.permissions,
      command: i.command, window: i.window, author: i.author, homepage: i.homepage,
      sourceId: '', sourceName: '', official: false,
      installedUser: false, installedGroup: false
    };
  }
  return miniState.detailApp;
});

const detailInstalled = computed(() => detailFromInstall.value);

function backToList(): void {
  detailFromInstall.value = null;
  miniState.detailApp = null;
  setMiniTab('installed');
}

function refresh(): void {
  void loadMiniIndex();
}
</script>

<template>
  <div
    v-if="miniState.panelOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    @click.self="closeMiniPanel"
  >
    <div
      ref="rootEl"
      class="relative flex w-[34rem] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel text-ink shadow-xl"
    >
      <div class="flex items-center gap-2 border-b border-line px-4 py-3">
        <span class="flex-1 text-base font-semibold">{{ tr('mini.title') }}</span>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs text-faint transition-colors hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
          :title="tr('mini.store.refresh')"
          @click="refresh"
        >{{ tr('mini.store.refresh') }}</button>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-lg leading-none text-faint transition-colors hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
          :title="tr('common.close')"
          :aria-label="tr('common.close')"
          @click="closeMiniPanel"
        >×</button>
      </div>

      <div class="flex border-b border-line">
        <button
          type="button"
          class="flex-1 -mb-px border-b-2 py-2 text-sm transition-colors"
          :class="miniState.panelTab === 'installed' ? 'border-primary font-semibold text-primary' : 'border-transparent text-faint hover:text-ink'"
          @click="detailFromInstall = null; miniState.detailApp = null; setMiniTab('installed')"
        >{{ tr('mini.tab.installed') }}</button>
        <button
          type="button"
          class="flex-1 -mb-px border-b-2 py-2 text-sm transition-colors"
          :class="miniState.panelTab === 'store' ? 'border-primary font-semibold text-primary' : 'border-transparent text-faint hover:text-ink'"
          @click="setMiniTab('store')"
        >{{ tr('mini.tab.store') }}</button>
        <button
          v-if="miniState.panelTab === 'detail'"
          type="button"
          class="flex-1 -mb-px border-b-2 border-primary py-2 text-sm font-semibold text-primary"
        >{{ tr('mini.tab.detail') }}</button>
      </div>

      <div class="max-h-[62vh] min-h-[16rem] overflow-y-auto px-4 py-3">
        <!-- 已安装 -->
        <div v-if="miniState.panelTab === 'installed'">
          <p v-if="!installed.length" class="py-8 text-center text-xs text-faint">{{ tr('mini.installed.empty') }}</p>
          <div v-else class="flex flex-col gap-2">
            <div
              v-for="i in installed"
              :key="i.appId + '/' + i.scopeType"
              class="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5"
            >
              <img v-if="i.icon" :src="asset(i.icon)" alt="" class="h-9 w-9 rounded-lg object-cover" />
              <span v-else class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-xs font-semibold">
                {{ i.name.slice(0, 1) }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-medium">
                  {{ i.name }}
                  <span class="ml-1 rounded-full border border-line px-1.5 py-px text-[10px] font-normal text-faint">
                    {{ scopeLabel(i) }}
                  </span>
                  <span v-if="i.command" class="ml-1 text-[11px] font-normal text-primary">#{{ i.command }}</span>
                </div>
                <div class="truncate text-[11px] text-faint">{{ i.summary || i.appId }}</div>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                @click="openInstalled(i)"
              >{{ tr('mini.open') }}</button>
              <button
                type="button"
                class="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-faint transition-colors hover:text-ink"
                @click="regrant(i)"
              >{{ tr('mini.regrant') }}</button>
              <button
                type="button"
                class="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-danger transition-colors hover:bg-danger/10"
                @click="remove(i)"
              >{{ tr('mini.uninstall') }}</button>
            </div>
          </div>
        </div>

        <!-- 商店 -->
        <div v-else-if="miniState.panelTab === 'store'">
          <input
            v-model="keyword"
            type="search"
            class="mb-3 w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm outline-none focus:border-primary"
            :placeholder="tr('mini.store.search')"
          />
          <p v-if="miniState.loading" class="py-8 text-center text-xs text-faint">{{ tr('common.loading') }}</p>
          <p v-else-if="miniState.error" class="py-8 text-center text-xs text-danger">{{ tr(miniState.error) }}</p>
          <p v-else-if="!storeApps.length" class="py-8 text-center text-xs text-faint">{{ tr('mini.store.empty') }}</p>
          <div v-else class="flex flex-col gap-2">
            <div
              v-for="a in storeApps"
              :key="a.id"
              class="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5"
            >
              <img v-if="a.icon" :src="asset(a.icon)" alt="" class="h-9 w-9 rounded-lg object-cover" />
              <span v-else class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-xs font-semibold">
                {{ a.name.slice(0, 1) }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-medium">
                  {{ a.name }}
                  <span class="ml-1 text-[11px] font-normal text-faint">v{{ a.version }}</span>
                  <span
                    v-if="a.official"
                    class="ml-1 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-normal text-primary"
                  >{{ tr('mini.official') }}</span>
                  <span v-else class="ml-1 text-[10px] font-normal text-faint">{{ a.sourceName }}</span>
                </div>
                <div class="truncate text-[11px] text-faint">{{ a.summary }}</div>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg border border-line px-2 py-1 text-xs transition-colors hover:text-primary"
                @click="openMiniDetail(a)"
              >{{ tr('mini.detail') }}</button>
              <button
                type="button"
                class="shrink-0 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                @click="install(a, 'user')"
              >{{ tr('mini.install.user') }}</button>
              <button
                v-if="inGroup"
                type="button"
                class="shrink-0 rounded-lg border border-line px-2 py-1 text-xs transition-colors hover:text-primary"
                @click="install(a, 'group')"
              >{{ tr('mini.install.group') }}</button>
            </div>
          </div>

          <div v-if="failedSources.length" class="mt-3 rounded-lg border border-line px-3 py-2 text-[11px] text-faint">
            <div v-for="s in failedSources" :key="s.id">{{ s.name }}：{{ s.error || tr('mini.store.loadFailed') }}</div>
          </div>
        </div>

        <!-- 详情与授权 -->
        <div v-else-if="detail">
          <div class="flex items-start gap-3">
            <img v-if="detail.icon" :src="asset(detail.icon)" alt="" class="h-14 w-14 rounded-xl object-cover" />
            <span v-else class="flex h-14 w-14 items-center justify-center rounded-xl bg-accent-soft text-lg font-semibold">
              {{ detail.name.slice(0, 1) }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-base font-semibold">{{ detail.name }}</div>
              <div class="text-[11px] text-faint">
                v{{ detail.version }}
                <template v-if="detail.author"> · {{ detail.author }}</template>
                <template v-if="detail.command"> · #{{ detail.command }}</template>
              </div>
              <p class="mt-1 text-[13px] text-muted">{{ detail.summary }}</p>
            </div>
          </div>

          <p v-if="detail.description" class="mt-3 whitespace-pre-wrap rounded-xl border border-line px-3 py-2 text-[12px] text-muted">
            {{ detail.description }}
          </p>

          <div class="mt-4">
            <div class="mb-1.5 text-[13px] font-medium">{{ tr('mini.perms.title') }}</div>
            <p v-if="!detail.permissions.length" class="text-[11px] text-faint">{{ tr('mini.perms.none') }}</p>
            <label
              v-for="p in detail.permissions"
              :key="p"
              class="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2 text-[12px]"
            >
              <input
                type="checkbox"
                class="mt-0.5"
                :checked="granted.indexOf(p) !== -1"
                @change="togglePerm(p)"
              />
              <span class="min-w-0">
                <span class="font-medium">{{ permText(p) }}</span>
                <span class="block text-[11px] text-faint">{{ tr('mini.perm.desc.' + p) }}</span>
              </span>
            </label>
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              :disabled="busy"
              @click="install(detail, 'user')"
            >{{ tr('mini.install.user') }}</button>
            <button
              v-if="inGroup"
              type="button"
              class="rounded-lg border border-line px-3 py-1.5 text-sm transition-colors hover:text-primary disabled:opacity-50"
              :disabled="busy"
              @click="install(detail, 'group')"
            >{{ tr('mini.install.group') }}</button>
            <button
              v-if="detailInstalled"
              type="button"
              class="rounded-lg border border-line px-3 py-1.5 text-sm transition-colors hover:text-primary disabled:opacity-50"
              :disabled="busy"
              @click="regrantMiniApp(detailInstalled, granted).then(() => backToList())"
            >{{ tr('mini.grant.save') }}</button>
            <button
              type="button"
              class="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm text-faint transition-colors hover:text-ink"
              @click="backToList"
            >{{ tr('common.back') }}</button>
          </div>

          <p v-if="detail.homepage" class="mt-3 truncate text-[11px] text-faint">
            <a :href="detail.homepage" target="_blank" rel="noopener noreferrer" class="hover:text-primary">{{ detail.homepage }}</a>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
