<script setup lang="ts">
/* ============================================================
 * 群成员面板（右侧抽屉）
 *
 * 面向**所有群成员**开放——以前只有群主/系统管理员能从侧栏齿轮进群管理页
 * 看成员，普通成员没有任何入口。这里直接读 /api/groups/members（服务端本来就
 * 只要求「是本群成员」），点成员打开资料卡。
 *
 * 排序：群主 → 在线（离开也算在线）→ 离线（按最后在线时间新的在前）。
 * ============================================================ */
import { computed, watch } from 'vue';
import {
  chatState,
  avatarColor,
  avatarFor,
  isOnline,
  isAway,
  statusText,
  getProfile,
  loadGroupMembers,
  lastSeenOf
} from '../../core/chat';
import { tr } from '../../core/i18n';
import type { GroupMember } from '../../types';

const open = defineModel<boolean>({ default: false });

function initial(name: string): string {
  return (name || '?').slice(0, 1);
}

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
      // 离线：越近上线的排越前；都没记录时按名字排
      const ta = lastSeenOf(a.name) || 0;
      const tb = lastSeenOf(b.name) || 0;
      if (tb !== ta) return tb - ta;
    }
    return a.name.localeCompare(b.name);
  });
});

const onlineCount = computed(() => chatState.activeGroupMembers.filter((m) => isOnline(m.name)).length);

/** 每次打开都重新拉一遍，免得看到过期的成员（加人/退群不会实时推送） */
watch(open, (v) => {
  if (v && chatState.activeGid != null) loadGroupMembers(chatState.activeGid);
});

// 切会话时收起：成员面板是「这个群」的信息，跟着会话走
watch(
  () => chatState.activeGid,
  () => {
    open.value = false;
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
      <button
        v-for="m in members"
        :key="m.name"
        type="button"
        class="mp-item"
        :class="{ away: isAway(m.name) }"
        @click="getProfile(m.name)"
      >
        <!-- 状态点不能放在 .user-avatar 里：它有 overflow:hidden，会把角上的点裁掉 -->
        <span class="mp-avatar-wrap">
          <span class="user-avatar mp-avatar">
            <img v-if="avatarFor(m.name)" :src="avatarFor(m.name)!" :alt="m.name" />
            <span v-else class="avatar-letter" :style="{ background: avatarColor(m.name) }">{{ initial(m.name) }}</span>
          </span>
          <i class="mp-dot" :class="isOnline(m.name) ? (isAway(m.name) ? 'is-away' : 'is-on') : 'is-off'"></i>
        </span>
        <span class="mp-meta">
          <span class="mp-name">
            {{ m.name }}<i v-if="m.name === chatState.me" class="mp-me">{{ tr('common.me') }}</i>
          </span>
          <span class="mp-status">{{ statusText(m.name) }}</span>
        </span>
        <span v-if="m.name === owner" class="owner-tag">{{ tr('chat.members.owner') }}</span>
      </button>

      <p v-if="!members.length" class="mp-empty">{{ tr('chat.members.empty') }}</p>
    </div>
  </aside>
</template>
