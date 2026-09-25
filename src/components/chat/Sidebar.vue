<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
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
  logout,
  openSearch,
  setFriendRemark
} from '../../core/chat';
import { tr } from '../../core/i18n';
import { prompt } from '../../core/dialog';
import { loadMiniInstalls, miniState, openMiniApp, openMiniPanel, type MiniInstallItem } from '../../core/mini';
import AppFooter from '../common/AppFooter.vue';
import LangMenu from '../common/LangMenu.vue';
import ThemeToggle from '../common/ThemeToggle.vue';
import MyInvitesDialog from '../group/MyInvitesDialog.vue';

const friends = computed(() => chatState.myFriends);
const requests = computed(() => chatState.friendRequests);
const groups = computed(() => chatState.myGroups);
const activeGid = computed(() => chatState.activeGid);
const activeDmPeer = computed(() => chatState.activeDmPeer);

// 我的群邀请（待我同意）弹窗 + 角标
const invitesOpen = ref(false);
const inviteCount = computed(() => (chatState.myInvites || []).length);

/** 好友显示名：有备注显示备注，否则用户名 */
function friendLabel(name: string): string {
  return chatState.friendRemarks[name] || name;
}

/** 设置/编辑好友备注（仅自己可见） */
function editRemark(name: string): void {
  prompt({
    title: tr('friend.remark'),
    text: tr('friend.remarkPlaceholder'),
    input: { type: 'text', placeholder: tr('friend.remarkPlaceholder'), maxLength: 500, value: chatState.friendRemarks[name] || '' }
  }).then((v) => {
    if (v == null) return;
    setFriendRemark(name, v.trim()).then((j) => {
      if (j.ok) chatState.friendRemarks[name] = v.trim();
    });
  });
}

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

/**
 * 侧栏「小程序」分区：只列个人级安装。
 * 它们不是好友，只是出现在列表里方便一键打开——点进去是小程序本身，没有聊天窗口。
 */
const miniApps = computed<MiniInstallItem[]>(() => {
  const kw = q.value.trim().toLowerCase();
  return miniState.installs.filter((i) => {
    if (i.scopeType !== 'user') return false;
    if (!kw) return true;
    return (i.name + ' ' + i.summary).toLowerCase().indexOf(kw) !== -1;
  });
});

function openMini(inst: MiniInstallItem): void {
  emit('navigate');
  void openMiniApp(inst);
}

function openMiniStore(): void {
  menuOpen.value = false;
  emit('navigate');
  openMiniPanel('store');
}

// 小程序列表随「当前群」变化（群级安装不同），启动时也拉一次
onMounted(() => {
  void loadMiniInstalls();
});
watch(() => chatState.activeGid, () => {
  void loadMiniInstalls();
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

/** 打开「全部会话」的聊天记录搜索（面板在聊天主区里，这里只负责打开） */
function openHistorySearch(): void {
  openSearch('all');
  emit('navigate'); 
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <div class="sidebar-brand">CircleChat</div>
      <!-- 全局：搜「我的全部会话」的聊天记录（不限于当前会话） -->
      <button
        type="button"
        class="sidebar-search-history"
        :title="tr('chat.search.all')"
        :aria-label="tr('chat.search.all')"
        @click="openHistorySearch"
      >
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />
        </svg>
      </button>
      <button
        type="button"
        class="sidebar-search-history"
        style="position: relative"
        :title="tr('group.myInvites')"
        :aria-label="tr('group.myInvites')"
        @click="invitesOpen = true"
      >
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
        </svg>
        <span v-if="inviteCount" class="unread-dot">{{ unreadText(inviteCount) }}</span>
      </button>
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
          <button type="button" class="group-action-btn" @click="openMiniStore">{{ tr('mini.store.open') }}</button>
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

      <!-- 小程序：个人级安装，像好友一样列在这里，点开即运行 -->
      <template v-if="miniApps.length">
        <div class="sidebar-section">{{ tr('mini.sidebar.section') }}</div>
        <button
          v-for="m in miniApps"
          :key="'mini:' + m.appId"
          type="button"
          class="user-item mini-item"
          :title="m.summary || m.name"
          @click="openMini(m)"
        >
          <div class="user-avatar">
            <img v-if="m.icon" :src="m.icon" :alt="m.name" />
            <span v-else class="avatar-letter" :style="{ background: avatarColor(m.appId) }">{{ initial(m.name) }}</span>
          </div>
          <div class="user-meta">
            <div class="user-name">{{ m.name }}</div>
            <div class="user-status">{{ m.command ? '#' + m.command : tr('mini.sidebar.hint') }}</div>
          </div>
        </button>
      </template>

      <div v-for="item in sortedItems" :key="keyOf(item)">
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
            <!-- 有人@我：红点单独标出（@我 + 未读数），与普通未读区分 -->
            <span v-if="chatState.mentionUnread['g:' + item.ref.id]" class="mention-dot">
              {{ tr('chat.mention.me') }} {{ unreadText(chatState.unread['g:' + item.ref.id] || 0) }}
            </span>
            <span v-else-if="chatState.unread['g:' + item.ref.id]" class="unread-dot">{{ unreadText(chatState.unread['g:' + item.ref.id]) }}</span>
          </button>
          <button
            v-if="item.ref.owner === chatState.me || chatState.isAdmin"
            type="button"
            class="group-gear"
            :title="tr('chat.group.manage')"
            @click="toGroupAdmin(item.ref)"
          >⚙</button>
        </div>

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
            <div class="user-name">
              {{ friendLabel(item.ref.name) }}<i v-if="chatState.friendRemarks[item.ref.name]" class="remark-real">（{{ item.ref.name }}）</i>
            </div>
            <div class="user-status">{{ statusText(item.ref.name) }}</div>
          </div>
          <button
            type="button"
            class="mini-btn remark-btn"
            :title="tr('friend.remark')"
            @click.stop="editRemark(item.ref.name)"
          >✎</button>
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

    <MyInvitesDialog v-if="invitesOpen" @close="invitesOpen = false" />

    <!-- 版权与项目地址：侧栏最底部独立一行，与侧栏内容同为左对齐 -->
    <AppFooter align="left" class="px-3 pb-2" />
  </aside>
</template>