<script setup lang="ts">
import { computed } from 'vue';
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

function onNotify(e: Event): void {
  const v = (e.target as HTMLInputElement).checked;
  saveSettings({ notify: v });
}
</script>

<template>
  <div class="chat-view">
    <Sidebar />

    <main class="chat-main">
      <header class="chat-header">
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
      </header>

      <MessageList />
      <InputBar />
    </main>

    <ProfileCard />
    <FriendSearch />
    <GroupDialog />
    <ContextMenu />
    <ForwardPicker />
  </div>
</template>
