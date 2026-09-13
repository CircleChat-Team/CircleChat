<script setup lang="ts">
import { computed, ref } from 'vue';
import { chatState, logout, saveSettings, toggleSelectMode } from './core/chat';
import { tr } from './core/i18n';
import Sidebar from './components/chat/Sidebar.vue';
import MessageList from './components/chat/MessageList.vue';
import InputBar from './components/chat/InputBar.vue';
import ProfileCard from './components/chat/ProfileCard.vue';
import FriendSearch from './components/chat/FriendSearch.vue';
import GroupDialog from './components/chat/GroupDialog.vue';
import ContextMenu from './components/chat/ContextMenu.vue';
import ForwardPicker from './components/chat/ForwardPicker.vue';
import LangMenu from './components/common/LangMenu.vue';
import ThemeToggle from './components/common/ThemeToggle.vue';

const title = computed(() => {
  if (chatState.activeDmPeer != null) return tr('chat.dm.title', { name: chatState.activeDmPeer });
  if (chatState.activeGid != null) {
    const g = chatState.myGroups.find((x) => x.id === chatState.activeGid);
    return g ? g.name : tr('chat.group.untitled');
  }
  return 'CircleChat';
});

const connClass = computed(() => chatState.connState);

// 移动端：侧边栏抽屉 + 设置面板开关
const sidebarOpen = ref(false);
const settingsOpen = ref(false);

function onNotify(e: Event): void {
  const v = (e.target as HTMLInputElement).checked;
  saveSettings({ notify: v });
}
</script>

<template>
  <div class="chat-view" :class="{ 'sidebar-open': sidebarOpen }">
    <Sidebar @navigate="sidebarOpen = false" />

    <div class="sidebar-backdrop" @click="sidebarOpen = false"></div>

    <main class="chat-main">
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
          <span class="dot" :class="connClass"></span>
          <span id="chatTitle">{{ title }}{{ chatState.me ? ' · ' + chatState.me : '' }}</span>
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
          <label class="switch" :title="tr('chat.notify.label')">
            <input type="checkbox" :checked="chatState.notifyOn" @change="onNotify" />
            <span class="slider"></span>
          </label>
          <LangMenu />
          <ThemeToggle />
          <button class="logout-btn" :title="tr('common.logout')" @click="logout">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
            </svg>
            <span>{{ tr('chat.logoutShort') }}</span>
          </button>
        </div>

        <button
          type="button"
          class="settings-toggle"
          :title="tr('chat.settings')"
          :aria-label="tr('chat.settings')"
          @click="settingsOpen = true"
        >
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.74 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.03.31-.05.62-.05.94s.02.63.05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.69.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.26.12.55.02.69-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
          </svg>
        </button>
      </header>

      <MessageList />
      <InputBar />
    </main>

    <ProfileCard />
    <FriendSearch />
    <GroupDialog />
    <ContextMenu />
    <ForwardPicker />

    <!-- 移动端设置面板：将顶栏散落的按钮统一收纳 -->
    <div class="settings-mask" :class="{ show: settingsOpen }" @click="settingsOpen = false"></div>
    <aside class="settings-panel" :class="{ open: settingsOpen }">
      <div class="settings-head">
        <span>{{ tr('chat.settings') }}</span>
        <button type="button" class="settings-close" :title="tr('common.close')" :aria-label="tr('common.close')" @click="settingsOpen = false">✕</button>
      </div>
      <div class="settings-body">
        <div class="settings-row">
          <span>{{ tr('chat.notify.label') }}</span>
          <label class="switch">
            <input type="checkbox" :checked="chatState.notifyOn" @change="onNotify" />
            <span class="slider"></span>
          </label>
        </div>
        <div class="settings-row">
          <span>{{ tr('common.lang') }}</span>
          <LangMenu />
        </div>
        <div class="settings-row">
          <span>{{ tr('common.theme') }}</span>
          <ThemeToggle />
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
        <button type="button" class="settings-link danger" @click="logout">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" /></svg>
          <span>{{ tr('common.logout') }}</span>
        </button>
      </div>
    </aside>
  </div>
</template>
