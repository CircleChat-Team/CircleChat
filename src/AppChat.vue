<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { get } from './core/api';
import {
  chatState,
  toggleSelectMode,
  setNotify,
  setSendKey,
  setNotifySound,
  setSoundIn,
  setSoundOut,
  clearNotice,
  uploadFiles
} from './core/chat';
import { NOTIFY_SOUNDS, playNotifyPreview, playOutgoingPreview } from './core/sound';
import { tr } from './core/i18n';
import { accent, setAccent } from './core/theme';
import { canSystemNotify } from './utils/notify';
import Sidebar from './components/chat/Sidebar.vue';
import MessageList from './components/chat/MessageList.vue';
import InputBar from './components/chat/InputBar.vue';
import ProfileCard from './components/chat/ProfileCard.vue';
import MyProfile from './components/chat/MyProfile.vue';
import StyleDialog from './components/chat/StyleDialog.vue';
import FriendSearch from './components/chat/FriendSearch.vue';
import GroupDialog from './components/chat/GroupDialog.vue';
import ContextMenu from './components/chat/ContextMenu.vue';
import Dialog from './components/common/Dialog.vue';
import MailboxPanel from './components/chat/MailboxPanel.vue';
import ForwardPicker from './components/chat/ForwardPicker.vue';
import MergeForwardViewer from './components/chat/MergeForwardViewer.vue';
import ImageViewer from './components/chat/ImageViewer.vue';
import VideoViewer from './components/chat/VideoViewer.vue';
import FileViewer from './components/chat/FileViewer.vue';
import ForceChangePassword from './components/common/ForceChangePassword.vue';

const title = computed(() => {
  if (chatState.activeDmPeer != null) return tr('chat.dm.title', { name: chatState.activeDmPeer });
  if (chatState.activeGid != null) {
    const g = chatState.myGroups.find((x) => x.id === chatState.activeGid);
    return g ? g.name : tr('chat.group.untitled');
  }
  return 'CircleChat';
});

const connClass = computed(() => chatState.connState);
// 连接状态原来只有一个彩色圆点，读屏/悬停都拿不到含义（这三词条本来就存在）
const connTitle = computed(() => {
  if (chatState.connState === 'on') return tr('chat.conn.on');
  return tr(chatState.connState === 'conn' ? 'chat.conn.notReady' : 'chat.conn.off');
});

// 当前群的群公告（有则显示横幅）
const activeAnnouncement = computed(() => {
  if (chatState.activeGid == null) return '';
  const g = chatState.myGroups.find((x) => x.id === chatState.activeGid);
  return (g && g.announcement) || '';
});

// 移动端：侧边栏抽屉 + 设置面板开关
const sidebarOpen = ref(false);
const settingsOpen = ref(false);

/** 系统通知只由桌面客户端提供，网页端把开关置灰 */
const notifyAvailable = canSystemNotify();

function onNotify(e: Event): void {
  const v = (e.target as HTMLInputElement).checked;
  void setNotify(v);
}

function onSendKey(mode: 'enter' | 'ctrl'): void {
  setSendKey(mode);
}

function onNotifySound(e: Event): void {
  const file = (e.target as HTMLSelectElement).value;
  setNotifySound(file);
  playNotifyPreview(file);
}

// 打开开关时试听一次，让用户知道这个开关对应的是哪个声音
function onSoundIn(e: Event): void {
  const on = (e.target as HTMLInputElement).checked;
  setSoundIn(on);
  if (on) playNotifyPreview(chatState.notifySound);
}

function onSoundOut(e: Event): void {
  const on = (e.target as HTMLInputElement).checked;
  setSoundOut(on);
  if (on) playOutgoingPreview();
}

// 标签页标题跟随当前会话（与登录页/群管理页的做法一致）
watch(
  title,
  (t) => {
    document.title = t && t !== 'CircleChat' ? t + ' · CircleChat' : 'CircleChat';
  },
  { immediate: true }
);

function onAccent(e: Event): void {
  setAccent((e.target as HTMLInputElement).value);
}
function resetAccent(): void {
  setAccent('');
}

// 强制改密成功后，解除拦截并关闭弹窗
function onPassChanged(): void {
  chatState.mustChange = false;
}

// 整屏拖拽上传：把文件拖到聊天区任意位置都能发送（此前只有输入栏一小条可接收）
const dragDepth = ref(0);
function isFileDrag(e: DragEvent): boolean {
  return !!(e.dataTransfer && Array.from(e.dataTransfer.types).indexOf('Files') !== -1);
}
function onDragOver(e: DragEvent): void {
  if (isFileDrag(e)) e.preventDefault();
}
function onDragEnter(e: DragEvent): void {
  if (isFileDrag(e)) dragDepth.value++;
}
function onDragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}
function onDrop(e: DragEvent): void {
  dragDepth.value = 0;
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    e.preventDefault();
    uploadFiles(e.dataTransfer.files);
  }
}

// ---- 右上角站内信（系统公告 / 通知 / 我的处罚） ----
const mailboxOpen = ref(false);
const mailboxUnread = ref(0);

function refreshMailboxBadge(): void {
  get('/api/me/notifications').then((j) => {
    if (j && j.ok) {
      const list = (j.notifications || []) as { read?: boolean }[];
      mailboxUnread.value = list.filter((x) => !x.read).length;
    }
  }).catch(() => { /* 静默：失败时不改红点 */ });
}

function openMailbox(): void {
  mailboxOpen.value = true;
}

function onMailboxRead(): void {
  mailboxUnread.value = 0;
}

function onMailboxClose(): void {
  mailboxOpen.value = false;
  refreshMailboxBadge();
}

onMounted(refreshMailboxBadge);
</script>

<template>
  <div class="chat-view" :class="{ 'sidebar-open': sidebarOpen }">
    <!-- 页面级轻提示：上传失败、门禁拦截、举报结果等（此前这类错误完全是静默的） -->
    <div
      v-if="chatState.notice"
      :key="chatState.noticeSeq"
      class="app-notice"
      :class="{ ok: chatState.noticeOk }"
      role="status"
      aria-live="polite"
    >
      <span>{{ tr(chatState.notice) }}</span>
      <button type="button" class="app-notice-x" :aria-label="tr('common.close')" @click="clearNotice">×</button>
    </div>

    <Sidebar @navigate="sidebarOpen = false" />

    <div class="sidebar-backdrop" @click="sidebarOpen = false"></div>

    <main
      class="chat-main"
      @dragenter="onDragEnter"
      @dragleave="onDragLeave"
      @dragover="onDragOver"
      @drop="onDrop"
    >
      <div v-if="dragDepth" class="drop-mask"><div class="drop-tip">{{ tr('chat.dropTip') }}</div></div>

      <header class="chat-header">
        <button
          type="button"
          class="sidebar-toggle"
          :title="tr('chat.sidebar.toggle')"
          :aria-label="tr('chat.sidebar.toggle')"
          @click="sidebarOpen = !sidebarOpen"
        >
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
          </svg>
        </button>

        <div class="chat-title">
          <span class="dot" :class="connClass" role="status" :title="connTitle" :aria-label="connTitle"></span>
          <span id="chatTitle">{{ title }}</span>
        </div>

        <div class="chat-actions">
          <a v-if="chatState.isAdmin" href="/admin.html" class="admin-entry" :title="tr('chat.adminPanel')">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
            </svg>
            <span>{{ tr('chat.adminPanel') }}</span>
          </a>
          <button
            v-if="chatState.activeGid != null || chatState.activeDmPeer != null"
            type="button"
            class="header-btn"
            :title="tr('chat.ctx.multi')"
            @click="toggleSelectMode"
          >{{ tr('chat.ctx.multi') }}</button>
          <button
            type="button"
            class="header-btn"
            :title="tr('mailbox.title')"
            @click="openMailbox"
          >
            <span class="relative inline-block">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
              </svg>
              <span v-if="mailboxUnread" class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                {{ mailboxUnread > 99 ? '99+' : mailboxUnread }}
              </span>
            </span>
          </button>
        </div>

        <button
          type="button"
          class="settings-toggle"
          :title="tr('chat.settings.title')"
          :aria-label="tr('chat.settings.title')"
          @click="settingsOpen = true"
        >
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.74 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.03.31-.05.62-.05.94s.02.63.05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.69.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.26.12.55.02.69-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
          </svg>
        </button>
      </header>

      <div v-if="activeAnnouncement" class="group-announce">
        <span class="ga-label">{{ tr('group.announce') }}</span>
        <span class="ga-text">{{ activeAnnouncement }}</span>
      </div>

      <MessageList />
      <InputBar />
    </main>

    <ProfileCard />
    <MyProfile />
    <Dialog />
    <MailboxPanel v-if="mailboxOpen" @close="onMailboxClose" @read="onMailboxRead" />
    <StyleDialog />
    <FriendSearch />
    <GroupDialog />
    <ContextMenu />
    <ForwardPicker />
    <MergeForwardViewer />
    <ImageViewer />
    <VideoViewer />
    <FileViewer />

    <!-- 移动端设置面板：将顶栏散落的按钮统一收纳 -->
    <div class="settings-mask" :class="{ show: settingsOpen }" @click="settingsOpen = false"></div>
    <aside class="settings-panel" :class="{ open: settingsOpen }">
      <div class="settings-head">
        <span>{{ tr('chat.settings.title') }}</span>
        <button type="button" class="settings-close" :title="tr('common.close')" :aria-label="tr('common.close')" @click="settingsOpen = false">✕</button>
      </div>
      <div class="settings-body">
        <div class="settings-row">
          <span>{{ tr('chat.notify.label') }}</span>
          <label class="switch">
            <input type="checkbox" :checked="chatState.notifyOn" :disabled="!notifyAvailable" @change="onNotify" />
            <span class="slider"></span>
          </label>
        </div>
        <!-- 网页端没有系统通知能力（通知由客户端通过 IPC 弹出），说明一下开关为什么点不动 -->
        <div v-if="!notifyAvailable" class="settings-hint">{{ tr('chat.notify.desktopOnly') }}</div>
        <div class="settings-row">
          <span>{{ tr('chat.settings.soundIn') }}</span>
          <label class="switch">
            <input type="checkbox" :checked="chatState.soundIn" @change="onSoundIn" />
            <span class="slider"></span>
          </label>
        </div>
        <div class="settings-row">
          <span>{{ tr('chat.settings.soundOut') }}</span>
          <label class="switch">
            <input type="checkbox" :checked="chatState.soundOut" @change="onSoundOut" />
            <span class="slider"></span>
          </label>
        </div>
        <div class="settings-row">
          <span>{{ tr('chat.settings.sendKey.label') }}</span>
          <div class="settings-seg">
            <button type="button" :class="{ on: chatState.sendKey === 'enter' }" @click="onSendKey('enter')">{{ tr('chat.settings.sendKey.enter') }}</button>
            <button type="button" :class="{ on: chatState.sendKey === 'ctrl' }" @click="onSendKey('ctrl')">{{ tr('chat.settings.sendKey.ctrl') }}</button>
          </div>
        </div>
        <div class="settings-row">
          <span>{{ tr('chat.settings.notifySound') }}</span>
          <select class="settings-select" :value="chatState.notifySound" @change="onNotifySound">
            <option v-for="s in NOTIFY_SOUNDS" :key="s.file" :value="s.file">{{ s.label }}</option>
          </select>
        </div>
        <div class="settings-row">
          <span>{{ tr('chat.settings.accent') }}</span>
          <div class="settings-accent">
            <input type="color" class="accent-input" :value="accent || '#07c160'" @input="onAccent" />
            <button v-if="accent" type="button" class="mini-btn no" @click="resetAccent">{{ tr('chat.settings.accentReset') }}</button>
          </div>
        </div>
        <a v-if="chatState.isAdmin" href="/admin.html" class="settings-link" @click="settingsOpen = false">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>
          <span>{{ tr('chat.adminPanel') }}</span>
        </a>
        <button
          v-if="chatState.activeGid != null || chatState.activeDmPeer != null"
          type="button"
          class="settings-link"
          @click="settingsOpen = false; toggleSelectMode()"
        >
          <span>{{ tr('chat.ctx.multi') }}</span>
        </button>
      </div>
    </aside>

    <!-- 强制改密拦截层：仍需改密时覆盖整个聊天界面 -->
    <ForceChangePassword v-if="chatState.mustChange" :username="chatState.me" forced @done="onPassChanged" />
  </div>
</template>
