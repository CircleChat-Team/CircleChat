<script setup lang="ts">
import { computed } from 'vue';
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
  getProfile
} from '../../core/chat';
import { tr } from '../../core/i18n';

const users = computed(() => chatState.allUsers);
const friends = computed(() => chatState.myFriends);
const requests = computed(() => chatState.friendRequests);
const groups = computed(() => chatState.myGroups);
const activeGid = computed(() => chatState.activeGid);
const activeDmPeer = computed(() => chatState.activeDmPeer);
const groupMembers = computed(() => chatState.activeGroupMembers);

function initial(name: string): string {
  return (name || '?').slice(0, 1);
}
function openDm(name: string): void {
  if (name === chatState.me) return;
  switchRoomToDm(name);
}
function openProfile(name: string): void {
  getProfile(name);
}
function openPublic(): void {
  switchRoom(null);
}
function openGroup(g: ChatGroup): void {
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
  chatState.friendSearchOpen = true;
}
function openCreateGroup(): void {
  chatState.groupDialogTab = 'create';
  chatState.groupDialogOpen = true;
}
function openJoinGroup(): void {
  chatState.groupDialogTab = 'search';
  chatState.groupDialogOpen = true;
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <div class="sidebar-brand">ChatPlus</div>
    </div>

    <div class="sidebar-scroll">
      <!-- 当前群组会话成员（私聊 / 公共房不显示成员列表） -->
      <template v-if="activeGid">
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
      </template>

      <!-- 好友区 -->
      <div class="sidebar-section-title sidebar-title-row">
        <span>{{ tr('chat.friends') }}</span>
        <button type="button" class="group-action-btn" @click="openFriendSearch">+ {{ tr('chat.friend.add') }}</button>
      </div>
      <div class="sidebar-friend-list">
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

      <!-- 好友申请 -->
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

      <!-- 群组 / 会话 -->
      <div class="sidebar-section-title">{{ tr('chat.sessions') }}</div>
      <button
        type="button"
        class="group-item"
        :class="{ active: activeGid == null && activeDmPeer == null }"
        @click="openPublic"
      >
        {{ tr('chat.publicRoom') }}
      </button>
      <div class="sidebar-group-list">
        <div v-for="g in groups" :key="g.id" class="group-item-wrap">
          <button
            type="button"
            class="group-item"
            :class="{ active: activeGid === g.id }"
            :title="tr('chat.group.owner', { name: g.owner })"
            @click="openGroup(g)"
          >
            {{ g.name }}<span v-if="g.owner === chatState.me"> {{ tr('common.me') }}</span>
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

    <div class="sidebar-foot">
      <span class="sidebar-me-label">{{ tr('chat.signedInAs') }}</span>
      <span class="sidebar-me">{{ chatState.me }}</span>
    </div>
  </aside>
</template>
