<script setup lang="ts">
/* ============================================================
 * 群成员面板（右侧抽屉）—— 面向所有群成员
 * 群主可设/取消管理员；管理员可禁言、移除普通成员；所有人可编辑自己的群昵称、
 * 群备注、邀请成员、退出群聊。
 * ============================================================ */
import { computed, ref, watch } from 'vue';
import {
  chatState,
  avatarColor,
  avatarFor,
  isOnline,
  isAway,
  statusText,
  getProfile,
  loadGroupMembers,
  lastSeenOf,
  setMemberRole,
  muteMember,
  setNickname,
  setGroupRemark,
  notify,
  switchRoom,
  loadGroups
} from '../../core/chat';
import { tr } from '../../core/i18n';
import { confirm, prompt } from '../../core/dialog';
import { post } from '../../core/api';
import type { GroupMember } from '../../types';
import InviteDialog from '../group/InviteDialog.vue';

const open = defineModel<boolean>({ default: false });
const showInvite = ref(false);

function initial(name: string): string {
  return (name || '?').slice(0, 1);
}

const me = computed(() => chatState.me);
const isManager = computed(() => !!chatState.activeGroupIsManager);
const owner = computed(() => {
  const g = chatState.myGroups.find((x) => x.id === chatState.activeGid);
  return g ? g.owner : '';
});

const members = computed<GroupMember[]>(() => {
  const list = chatState.activeGroupMembers.slice();
  const rank = (m: GroupMember): number => {
    if (m.name === owner.value) return 0;
    if (isOnline(m.name)) return 1;
    return 2;
  };
  return list.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 2) {
      const ta = lastSeenOf(a.name) || 0;
      const tb = lastSeenOf(b.name) || 0;
      if (tb !== ta) return tb - ta;
    }
    return a.name.localeCompare(b.name);
  });
});

const onlineCount = computed(() => chatState.activeGroupMembers.filter((m) => isOnline(m.name)).length);

/** 可管理对象：管理者、非群主、非自己、非管理员 */
function manageable(m: GroupMember): boolean {
  return isManager.value && !m.owner && m.name !== me.value && m.role !== 'admin';
}

function toggleAdmin(m: GroupMember): void {
  const role = m.role === 'admin' ? 'member' : 'admin';
  setMemberRole(chatState.activeGid!, m.name, role).then((j) => {
    if (j.ok) loadGroupMembers(chatState.activeGid!);
    else toast(j.error || 'common.opFailed');
  });
}
function toggleMute(m: GroupMember): void {
  muteMember(chatState.activeGid!, m.name, !m.muted).then((j) => {
    if (j.ok) loadGroupMembers(chatState.activeGid!);
    else toast(j.error || 'common.opFailed');
  });
}
function removeMember(m: GroupMember): void {
  confirm({
    title: tr('group.removeTitle'),
    text: tr('group.removeConfirm', { name: m.name }),
    okText: tr('group.remove')
  }).then((ok) => {
    if (!ok) return;
    post('/api/groups/members/remove', { gid: chatState.activeGid, name: m.name }).then((j) => {
      toast(j.ok ? tr('group.removed', { name: m.name }) : tr(j.error || 'common.opFailed'));
      if (j.ok) loadGroupMembers(chatState.activeGid!);
    });
  });
}

function editNickname(): void {
  const cur = (chatState.activeGroupMembers.find((m) => m.name === me.value) || {}).nickname || '';
  prompt({
    title: tr('group.nickname'),
    text: tr('group.nicknamePlaceholder'),
    input: { type: 'text', placeholder: tr('group.nicknamePlaceholder'), maxLength: 24, value: cur }
  }).then((v) => {
    if (v == null) return;
    setNickname(chatState.activeGid!, v.trim()).then((j) => {
      toast(j.ok ? tr('group.nicknameSaved') : tr(j.error || 'common.opFailed'));
      if (j.ok) loadGroupMembers(chatState.activeGid!);
    });
  });
}

function editRemark(): void {
  fetch('/api/groups/remark?gid=' + encodeURIComponent(chatState.activeGid!), { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((j) => {
      prompt({
        title: tr('group.remark'),
        text: tr('group.remarkPlaceholder'),
        input: { type: 'text', placeholder: tr('group.remarkPlaceholder'), maxLength: 500, value: (j && j.remark) || '' }
      }).then((v) => {
        if (v == null) return;
        setGroupRemark(chatState.activeGid!, v.trim()).then((jj) => {
          toast(jj.ok ? tr('group.remarkSaved') : tr(jj.error || 'common.opFailed'));
        });
      });
    });
}

function leave(): void {
  const gid = chatState.activeGid;
  confirm({
    title: tr('group.leave'),
    text: tr('group.leaveConfirm'),
    okText: tr('group.leave')
  }).then((ok) => {
    if (!ok) return;
    post('/api/groups/leave', { gid }).then((j) => {
      toast(j.ok ? tr('group.left') : tr(j.error || 'common.opFailed'));
      if (j.ok) {
        open.value = false;
        loadGroups();
        // 退群后该群会从我的群列表移除，若当前正停在该群则切回公共频道
        if (chatState.activeGid === gid) switchRoom(null);
      }
    });
  });
}

function onInvited(): void {
  showInvite.value = false;
}

function toast(msg: string): void {
  notify(msg);
}

watch(open, (v) => {
  if (v && chatState.activeGid != null) loadGroupMembers(chatState.activeGid);
});

watch(
  () => chatState.activeGid,
  () => {
    open.value = false;
    showInvite.value = false;
  }
);
</script>

<template>
  <aside v-if="open && chatState.activeGid != null" class="member-panel">
    <header class="mp-head">
      <span class="mp-title">{{ tr('chat.members.title') }}</span>
      <span class="mp-count">{{ onlineCount }}/{{ chatState.activeGroupMembers.length }}</span>
      <button
        type="button"
        class="mp-close"
        :title="tr('common.close')"
        :aria-label="tr('common.close')"
        @click="open = false"
      >×</button>
    </header>

    <div class="mp-body">
      <div
        v-for="m in members"
        :key="m.name"
        class="mp-item"
        :class="{ away: isAway(m.name) }"
      >
        <span class="mp-avatar-wrap" @click="getProfile(m.name)">
          <span class="user-avatar mp-avatar">
            <img v-if="avatarFor(m.name)" :src="avatarFor(m.name)!" :alt="m.name" />
            <span v-else class="avatar-letter" :style="{ background: avatarColor(m.name) }">{{ initial(m.name) }}</span>
          </span>
          <i class="mp-dot" :class="isOnline(m.name) ? (isAway(m.name) ? 'is-away' : 'is-on') : 'is-off'"></i>
        </span>
        <span class="mp-meta" @click="getProfile(m.name)">
          <span class="mp-name">
            {{ m.nickname || m.name }}<span v-if="m.nickname" class="mp-nick">（{{ m.name }}）</span>
            <i v-if="m.name === me" class="mp-me">{{ tr('common.me') }}</i>
          </span>
          <span class="mp-status">{{ statusText(m.name) }}</span>
        </span>
        <span v-if="m.name === owner" class="owner-tag">{{ tr('chat.members.owner') }}</span>
        <span v-else-if="m.role === 'admin'" class="admin-tag">{{ tr('group.roleAdmin') }}</span>
        <span v-if="m.muted" class="muted-tag">{{ tr('group.memberMuted') }}</span>

        <span v-if="manageable(m)" class="mp-actions">
          <button
            v-if="owner === me"
            type="button"
            class="mp-act"
            :title="m.role === 'admin' ? tr('group.removeAdmin') : tr('group.setAdmin')"
            @click="toggleAdmin(m)"
          >{{ m.role === 'admin' ? tr('group.removeAdmin') : tr('group.setAdmin') }}</button>
          <button
            v-if="m.role !== 'admin'"
            type="button"
            class="mp-act"
            :title="m.muted ? tr('group.unmuteMember') : tr('group.muteMember')"
            @click="toggleMute(m)"
          >{{ m.muted ? tr('group.unmuteMember') : tr('group.muteMember') }}</button>
          <button
            v-if="m.role !== 'admin'"
            type="button"
            class="mp-act danger"
            :title="tr('group.remove')"
            @click="removeMember(m)"
          >{{ tr('group.remove') }}</button>
        </span>
      </div>

      <p v-if="!members.length" class="mp-empty">{{ tr('chat.members.empty') }}</p>
    </div>

    <footer class="mp-foot">
      <button type="button" class="mp-foot-btn" @click="editNickname">{{ tr('group.nickname') }}</button>
      <button type="button" class="mp-foot-btn" @click="editRemark">{{ tr('group.remark') }}</button>
      <button type="button" class="mp-foot-btn primary" @click="showInvite = true">{{ tr('group.invite') }}</button>
      <button type="button" class="mp-foot-btn danger" @click="leave">{{ tr('group.leave') }}</button>
    </footer>

    <InviteDialog v-if="showInvite" :gid="chatState.activeGid!" @close="onInvited" />
  </aside>
</template>
