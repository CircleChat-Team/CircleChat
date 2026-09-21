<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChatGroup, Friend } from '../../types';
import {
  chatState,
  switchRoom,
  switchRoomToDm,
  friendAccept,
  friendDecline,
  avatarFor,
  avatarColor,
  isOnline,
  isAway,
  statusText,
  selfStatus,
  setInvisible,
  openMyProfile,
  openStyle,
  logout
} from '../../core/chat';
import { tr } from '../../core/i18n';
import AppFooter from '../common/AppFooter.vue';
import LangMenu from '../common/LangMenu.vue';
import ThemeToggle from '../common/ThemeToggle.vue';

const friends = computed(() => chatState.myFriends);
const requests = computed(() => chatState.friendRequests);
const groups = computed(() => chatState.myGroups);
const activeGid = computed(() => chatState.activeGid);
const activeDmPeer = computed(() => chatState.activeDmPeer);

// 顶部搜索框关键词：本地过滤合并列表
const q = ref('');
// “+” 功能菜单（新建群 / 加入群 / 添加好友）是否展开
const menuOpen = ref(false);
// 底部用户菜单：点击头像/名称弹出（个人资料 + 退出登录）
const userMenuOpen = ref(false);

type Entry = { kind: 'group'; ref: ChatGroup } | { kind: 'friend'; ref: Friend };
// 群 + 好友 合并直排，收到新消息的会话自动置顶
const sortedItems = computed<Entry[]>(() => {
  const kw = q.value.trim().toLowerCase();
  const arr: { entry: Entry; sort: number }[] = [];
  for (const g of groups.value) {
    if (kw && !g.name.toLowerCase().includes(kw)) continue;
    arr.push({ entry: { kind: 'group', ref: g }, sort: chatState.lastTs['g:' + String(g.id)] || 0 });
  }
  for (const f of friends.value) {
    if (kw && !f.name.toLowerCase().includes(kw)) continue;
    arr.push({ entry: { kind: 'friend', ref: f }, sort: chatState.lastTs['d:' + f.name] || 0 });
  }
  arr.sort((a, b) => b.sort - a.sort);
  return arr.map((x) => x.entry);
});

function keyOf(e: Entry): string {
  return e.kind + ':' + (e.kind === 'group' ? e.ref.id : e.ref.name);
}
function unreadText(n: number): string {
  return n > 99 ? '99+' : String(n);
}
function initial(name: string): string {
  return (name || '?').slice(0, 1);
}
function openDm(name: string): void {
  if (name === chatState.me) return;
  emit('navigate');
  switchRoomToDm(name);
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
  menuOpen.value = false;
  emit('navigate');
  chatState.groupDialogTab = 'create';
  chatState.groupDialogOpen = true;
}
function openJoinGroup(): void {
  menuOpen.value = false;
  emit('navigate');
  chatState.groupDialogTab = 'search';
  chatState.groupDialogOpen = true;
}
function openMyProfileCb(): void {
  userMenuOpen.value = false;
  openMyProfile();
}
function openStyleCb(): void {
  userMenuOpen.value = false;
  openStyle();
}
function doLogout(): void {
  userMenuOpen.value = false;
  logout();
}
const emit = defineEmits(['navigate']);
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <div class="sidebar-brand">CircleChat</div>
    </div>

    <!-- 顶部工具：搜索框 + 功能“+” -->
    <div class="sidebar-tools">
      <div class="sidebar-search-row">
        <input v-model="q" type="text" class="sidebar-search" :placeholder="tr('sidebar.search.placeholder')" maxlength="64" />
        <button type="button" class="sidebar-plus" @click="menuOpen = !menuOpen">+</button>
        <div v-if="menuOpen" class="sidebar-menu">
          <button type="button" class="group-action-btn" @click="openCreateGroup">{{ tr('chat.group.create') }}</button>
          <button type="button" class="group-action-btn" @click="openJoinGroup">{{ tr('chat.group.join') }}</button>
          <button type="button" class="group-action-btn" @click="openFriendSearch">{{ tr('chat.friend.add') }}</button>
        </div>
      </div>
    </div>

    <!-- 直排列表：好友申请（无标题）→ 群与好友（新消息自动置顶） -->
    <div class="sidebar-scroll">
      <template v-if="requests.length">
        <div v-for="r in requests" :key="'req:' + r.from" class="request-item">
          <span class="request-name">{{ r.from }}</span>
          <div class="request-actions">
            <button type="button" class="mini-btn ok" @click="accept(r.from)">{{ tr('chat.friend.accept') }}</button>
            <button type="button" class="mini-btn no" @click="decline(r.from)">{{ tr('chat.friend.reject') }}</button>
          </div>
        </div>
      </template>

      <div v-for="item in sortedItems" :key="keyOf(item)">
        <!-- 群聊 -->
        <div v-if="item.kind === 'group'" class="group-item-wrap">
          <button
            type="button"
            class="group-item"
            :class="{ active: activeGid === item.ref.id }"
            :title="tr('chat.group.owner', { name: item.ref.owner })"
            @click="openGroup(item.ref)"
          >
            <img v-if="item.ref.avatar" class="group-avatar" :src="item.ref.avatar" :alt="item.ref.name" />
            <span v-else class="group-avatar placeholder" :style="{ background: avatarColor(item.ref.id) }">
              {{ initial(item.ref.name) }}
            </span>
            <span class="truncate">{{ item.ref.name }}<i v-if="item.ref.owner === chatState.me"> {{ tr('common.me') }}</i></span>
            <span v-if="chatState.unread['g:' + item.ref.id]" class="unread-dot">{{ unreadText(chatState.unread['g:' + item.ref.id]) }}</span>
          </button>
          <button
            v-if="item.ref.owner === chatState.me || chatState.isAdmin"
            type="button"
            class="group-gear"
            :title="tr('chat.group.manage')"
            @click="toGroupAdmin(item.ref)"
          >⚙</button>
        </div>

        <!-- 好友 / 私聊 -->
        <div
          v-else
          class="user-item"
          :class="{ active: activeDmPeer === item.ref.name, online: isOnline(item.ref.name), away: isAway(item.ref.name), offline: !isOnline(item.ref.name) }"
          @click="openDm(item.ref.name)"
        >
          <div class="user-avatar">
            <img v-if="avatarFor(item.ref.name)" :src="avatarFor(item.ref.name)!" :alt="item.ref.name" />
            <span v-else class="avatar-letter" :style="{ background: avatarColor(item.ref.name) }">{{ initial(item.ref.name) }}</span>
          </div>
          <div class="user-meta">
            <div class="user-name">{{ item.ref.name }}</div>
            <div class="user-status">{{ statusText(item.ref.name) }}</div>
          </div>
          <span v-if="chatState.unread['d:' + item.ref.name]" class="unread-dot">{{ unreadText(chatState.unread['d:' + item.ref.name]) }}</span>
        </div>
      </div>

      <p v-if="!sortedItems.length && !requests.length" class="sidebar-empty">{{ tr('chat.friend.empty') }}</p>
    </div>

    <div class="sidebar-foot">
      <div class="sidebar-user-wrap">
        <button type="button" class="sidebar-user" :title="tr('chat.profile.self')" @click="userMenuOpen = !userMenuOpen">
          <div class="user-avatar">
            <img v-if="avatarFor(chatState.me)" :src="avatarFor(chatState.me)!" :alt="chatState.me" />
            <span v-else class="avatar-letter" :style="{ background: avatarColor(chatState.me) }">{{ initial(chatState.me) }}</span>
          </div>
          <span class="sidebar-me">{{ chatState.me }}</span>
          <svg class="user-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z" /></svg>
        </button>
        <div class="sidebar-foot-tools">
          <LangMenu up />
          <ThemeToggle />
        </div>
      </div>
      <div v-if="userMenuOpen" class="user-menu">
        <button type="button" class="user-menu-item" @click="openMyProfileCb">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
          <span>{{ tr('chat.profile.self') }}</span>
        </button>
        <button type="button" class="user-menu-item" @click="openStyleCb">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-9 9c0 2.4.95 4.6 2.5 6.2l.7-.7V21a9 9 0 0 0 9-9l-.4-2.6a4 4 0 0 0-4.8-4.8L8 2.6A9 9 0 0 0 12 3z"/></svg>
          <span>{{ tr('profile.style.label') }}</span>
        </button>
        <button type="button" class="user-menu-item status-row" :class="{ on: selfStatus.invisible }" @click="setInvisible(!selfStatus.invisible)">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
          <span class="status-label">{{ tr('chat.status.invisible') }}</span>
          <span class="status-switch" :class="{ on: selfStatus.invisible }"><i></i></span>
        </button>
        <button type="button" class="user-menu-item danger" @click="doLogout">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" /></svg>
          <span>{{ tr('common.logout') }}</span>
        </button>
      </div>
    </div>

    <!-- 版权与项目地址：侧栏最底部独立一行，与侧栏内容同为左对齐 -->
    <AppFooter align="left" class="px-3 pb-2" />
  </aside>
</template>