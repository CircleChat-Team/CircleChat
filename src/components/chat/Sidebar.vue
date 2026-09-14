<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ChatGroup } from '../../types';
import {
  chatState,
  switchRoom,
  switchRoomToDm,
  friendAccept,
  friendDecline,
  avatarFor,
  avatarColor,
  isOnline,
  getProfile,
  logout
} from '../../core/chat';
import { tr } from '../../core/i18n';

const users = computed(() => chatState.allUsers);
const friends = computed(() => chatState.myFriends);
const requests = computed(() => chatState.friendRequests);
const groups = computed(() => chatState.myGroups);
const activeGid = computed(() => chatState.activeGid);
const activeDmPeer = computed(() => chatState.activeDmPeer);
const groupMembers = computed(() => chatState.activeGroupMembers);

// 侧边栏分页签：会话 / 好友 / 成员，三者各自独立，不再混在同一滚动区
const tab = ref<'sessions' | 'friends' | 'members'>('sessions');
// 底部用户菜单：点击头像/名称弹出（个人资料 + 退出登录）
const userMenuOpen = ref(false);
function openMyProfile(): void {
  userMenuOpen.value = false;
  if (chatState.me) getProfile(chatState.me);
}
function doLogout(): void {
  userMenuOpen.value = false;
  logout();
}
// 退出群聊（切到私聊）时，若停留在成员页签则回退到会话页签
watch(activeGid, (g) => {
  if (!g && tab.value === 'members') tab.value = 'sessions';
});

const emit = defineEmits(['navigate']);

function initial(name: string): string {
  return (name || '?').slice(0, 1);
}
function openDm(name: string): void {
  if (name === chatState.me) return;
  emit('navigate');
  switchRoomToDm(name);
}
function openProfile(name: string): void {
  emit('navigate');
  getProfile(name);
}
function openGroup(g: ChatGroup): void {
  emit('navigate');
  switchRoom(g.id);
}
function toGroupAdmin(g: ChatGroup): void {
  location.href = '/group.html?gid=' + encodeURIComponent(g.id);
}
function accept(from: string): void {
  friendAccept(from);
}
function decline(from: string): void {
  friendDecline(from);
}
function openFriendSearch(): void {
  emit('navigate');
  chatState.friendSearchOpen = true;
}
function openCreateGroup(): void {
  emit('navigate');
  chatState.groupDialogTab = 'create';
  chatState.groupDialogOpen = true;
}
function openJoinGroup(): void {
  emit('navigate');
  chatState.groupDialogTab = 'search';
  chatState.groupDialogOpen = true;
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <div class="sidebar-brand">CircleChat</div>
    </div>

    <div class="sidebar-scroll">
      <!-- 分页签：会话 / 好友 / 成员，三者各自独立，不再混在同一滚动区 -->
      <div class="sidebar-tabs">
        <button type="button" class="tab-btn" :class="{ active: tab === 'sessions' }" @click="tab = 'sessions'">{{ tr('chat.tab.sessions') }}</button>
        <button type="button" class="tab-btn" :class="{ active: tab === 'friends' }" @click="tab = 'friends'">{{ tr('chat.tab.friends') }}</button>
        <button v-if="activeGid" type="button" class="tab-btn" :class="{ active: tab === 'members' }" @click="tab = 'members'">{{ tr('chat.tab.members') }}</button>
      </div>

      <!-- 会话页签：群聊列表 -->
      <div v-show="tab === 'sessions'" class="tab-pane">
        <div class="sidebar-group-list" style="padding-top: 4px;">
          <div v-for="g in groups" :key="g.id" class="group-item-wrap">
            <button
              type="button"
              class="group-item"
              :class="{ active: activeGid === g.id }"
              :title="tr('chat.group.owner', { name: g.owner })"
              @click="openGroup(g)"
            >
              <img v-if="g.avatar" class="group-avatar" :src="g.avatar" :alt="g.name" />
              <span v-else class="group-avatar placeholder" :style="{ background: avatarColor(g.id) }">
                {{ initial(g.name) }}
              </span>
              <span class="truncate">{{ g.name }}<i v-if="g.owner === chatState.me"> {{ tr('common.me') }}</i></span>
            </button>
            <button
              v-if="g.owner === chatState.me || chatState.isAdmin"
              type="button"
              class="group-gear"
              :title="tr('chat.group.manage')"
              @click="toGroupAdmin(g)"
            >⚙</button>
          </div>
        </div>
        <div class="group-actions">
          <button type="button" class="group-action-btn" @click="openCreateGroup">+ {{ tr('chat.group.create') }}</button>
          <button type="button" class="group-action-btn" @click="openJoinGroup">{{ tr('chat.group.join') }}</button>
        </div>
      </div>

      <!-- 好友页签：好友 + 申请 -->
      <div v-show="tab === 'friends'" class="tab-pane">
        <div class="sidebar-friend-list" style="padding-top: 4px;">
          <div
            v-for="f in friends"
            :key="f.name"
            class="user-item"
            :class="{ online: isOnline(f.name), offline: !isOnline(f.name) }"
            @click="openDm(f.name)"
          >
            <div class="user-avatar">
              <img v-if="avatarFor(f.name)" :src="avatarFor(f.name)!" :alt="f.name" />
              <span v-else class="avatar-letter" :style="{ background: avatarColor(f.name) }">{{ initial(f.name) }}</span>
            </div>
            <div class="user-meta">
              <div class="user-name">{{ f.name }}</div>
              <div class="user-status">{{ isOnline(f.name) ? tr('common.online') : tr('common.offline') }}</div>
            </div>
          </div>
          <p v-if="!friends.length" class="sidebar-empty">{{ tr('chat.friend.empty') }}</p>
        </div>

        <template v-if="requests.length">
          <div class="sidebar-sub-title">{{ tr('chat.friend.requests') }}</div>
          <div class="sidebar-friend-list">
            <div v-for="r in requests" :key="r.from" class="request-item">
              <span class="request-name">{{ r.from }}</span>
              <div class="request-actions">
                <button type="button" class="mini-btn ok" @click="accept(r.from)">{{ tr('chat.friend.accept') }}</button>
                <button type="button" class="mini-btn no" @click="decline(r.from)">{{ tr('chat.friend.reject') }}</button>
              </div>
            </div>
          </div>
        </template>

        <div class="group-actions">
          <button type="button" class="group-action-btn" @click="openFriendSearch">+ {{ tr('chat.friend.add') }}</button>
        </div>
      </div>

      <!-- 成员页签：仅当前在群内时出现 -->
      <div v-show="tab === 'members'" class="tab-pane">
        <div class="sidebar-section-title">{{ tr('chat.members') }}<span v-if="groupMembers.length"> · {{ groupMembers.length }}</span></div>
        <div class="sidebar-list">
          <div
            v-for="m in groupMembers"
            :key="m.name"
            class="user-item"
            :class="{ me: m.name === chatState.me, online: isOnline(m.name), offline: !isOnline(m.name) }"
            @click="openProfile(m.name)"
          >
            <div class="user-avatar">
              <img v-if="avatarFor(m.name)" :src="avatarFor(m.name)!" :alt="m.name" />
              <span v-else class="avatar-letter" :style="{ background: avatarColor(m.name) }">{{ initial(m.name) }}</span>
            </div>
            <div class="user-meta">
              <div class="user-name">{{ m.name }}<span v-if="m.owner" class="owner-tag">★</span><span v-if="m.name === chatState.me"> {{ tr('common.me') }}</span></div>
              <div class="user-status">{{ isOnline(m.name) ? tr('common.online') : tr('common.offline') }}</div>
            </div>
            <div class="user-dot"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="sidebar-foot">
      <button type="button" class="sidebar-user" :title="tr('chat.profile.self')" @click="userMenuOpen = !userMenuOpen">
        <div class="user-avatar">
          <img v-if="avatarFor(chatState.me)" :src="avatarFor(chatState.me)!" :alt="chatState.me" />
          <span v-else class="avatar-letter" :style="{ background: avatarColor(chatState.me) }">{{ initial(chatState.me) }}</span>
        </div>
        <span class="sidebar-me">{{ chatState.me }}</span>
        <svg class="user-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z" /></svg>
      </button>
      <div v-if="userMenuOpen" class="user-menu">
        <button type="button" class="user-menu-item" @click="openMyProfile">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
          <span>{{ tr('chat.profile.self') }}</span>
        </button>
        <button type="button" class="user-menu-item danger" @click="doLogout">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" /></svg>
          <span>{{ tr('common.logout') }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>
