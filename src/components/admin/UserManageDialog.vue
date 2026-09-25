<script setup lang="ts">
/* ============================================================
 * 账号管理弹窗
 * 列表行里只留一个「管理」按钮，具体操作（改用户名 / 重置密码 /
 * 设置头像 / 删除账号）收进这里。
 * 原因：功能越加越多，平铺一排按钮会把行挤爆，也容易误点。
 * Esc / 点遮罩关闭；子弹窗（输入框、确认框）叠在上面时 Esc 只关它。
 * ============================================================ */
import { computed, inject, ref } from 'vue';
import { post } from '../../core/api';
import { tr } from '../../core/i18n';
import { confirm, prompt } from '../../core/dialog';
import { uploadAvatar } from '../../core/chat';
import { fmtDate } from '../../core/format';
import { presenceText } from '../../core/presence';
import { passwordOk } from '../../core/password';
import { useOverlay } from '../../core/useOverlay';
import type { UserItem } from '../../types';

const props = defineProps<{ user: UserItem | null; me: string }>();

/** 状态文案（网页端 / 客户端 / 两端同时在线；离线时显示最后在线） */
/** 状态文案（已翻译）；别再套 tr('common.' + ...) —— 那会把键名显示出来 */
function statusText(u: UserItem | null): string {
  return presenceText(!!(u && u.online), false, u ? u.platform : null, u ? u.lastSeen : null);
}
const emit = defineEmits<{ close: []; changed: [] }>();

type ToastFn = (msg: string, ms?: number) => void;
const toast = inject<ToastFn>('toast', () => {});

const rootEl = ref<HTMLElement | null>(null);

const isSelf = computed(() => !!props.user && props.user.name === props.me);
const created = computed(() => (props.user ? fmtDate(props.user.created) : ''));

useOverlay({
  isOpen: () => !!props.user,
  onClose: () => emit('close'),
  container: () => rootEl.value
});

function changeName(): void {
  const u = props.user;
  if (!u) return;
  prompt({
    title: tr('admin.users.renameTitle'),
    text: tr('admin.users.renamePrompt', { name: u.name }),
    okText: tr('admin.users.renameOk'),
    input: { type: 'text', placeholder: u.name, maxLength: 20 }
  }).then((v) => {
    if (v == null) return;
    const newName = v.trim();
    if (!newName || newName === u.name) return;
    post('/api/admin/user/rename', { name: u.name, newName }).then((j) => {
      toast(j.ok ? tr('admin.users.renamed', { name: newName }) : tr(j.error || 'common.opFailed'));
      if (!j.ok) return;
      emit('changed');
      emit('close'); // 名字变了，行的身份随之变化，关掉重来更清楚
    });
  });
}

function changePass(): void {
  const u = props.user;
  if (!u) return;
  prompt({
    title: tr('admin.users.resetTitle'),
    text: tr('admin.users.resetPrompt', { name: u.name }),
    okText: tr('admin.users.resetOk'),
    danger: false,
    input: { type: 'password', placeholder: tr('admin.users.newPassPlaceholder'), maxLength: 64 }
  }).then((p) => {
    if (p == null) return;
    if (!passwordOk(p)) {
      toast(tr('reg.short'));
      return;
    }
    post('/api/admin/user/pass', { name: u.name, password: p }).then((j) => {
      toast(j.ok ? tr('admin.users.passResetLogout') : tr(j.error || 'common.opFailed'));
    });
  });
}

// 与本人头像一致：只提供「上传」（服务端只认本站上传路径）
const avatarInput = ref<HTMLInputElement | null>(null);

function setAvatar(): void {
  if (props.user) avatarInput.value?.click();
}
function onAvatarPicked(e: Event): void {
  const el = e.target as HTMLInputElement;
  const file = el.files && el.files[0];
  el.value = '';
  const u = props.user;
  if (!file || !u) return;
  uploadAvatar(file).then((url) => {
    if (!url) return;
    post('/api/admin/user/image', { name: u.name, image: url }).then((j) => {
      toast(j.ok ? tr('admin.users.avatarUpdated') : tr(j.error || 'common.opFailed'));
      if (j.ok) emit('changed');
    });
  });
}

function remove(): void {
  const u = props.user;
  if (!u) return;
  confirm({
    title: tr('admin.users.delTitle'),
    text: tr('admin.users.delConfirm', { name: u.name }),
    okText: tr('admin.users.delBtn')
  }).then((ok) => {
    if (!ok) return;
    post('/api/admin/user/del', { name: u.name }).then((j) => {
      toast(j.ok ? tr('admin.users.deleted', { name: u.name }) : tr(j.error || 'common.opFailed'));
      if (!j.ok) return;
      emit('changed');
      emit('close');
    });
  });
}

/** 操作项列表：模板里只遍历，增删一项不用改结构 */
/**
 * 改权限：普通用户 ⇄ 管理员。
 * 角色是每次请求从库里读的，改完立即生效（不用踢下线）；
 * 「至少保留一个管理员」由服务端拦（那里才知道还剩几个管理员）。
 */
function changeRole(): void {
  const u = props.user;
  if (!u) return;
  const toAdmin = u.role !== 'admin';
  confirm({
    title: tr('admin.users.roleTitle'),
    text: tr(toAdmin ? 'admin.users.rolePromoteConfirm' : 'admin.users.roleDemoteConfirm', { name: u.name }),
    okText: tr(toAdmin ? 'admin.users.rolePromote' : 'admin.users.roleDemote')
  }).then((ok) => {
    if (!ok) return;
    post('/api/admin/user/role', { name: u.name, role: toAdmin ? 'admin' : 'user' }).then((j) => {
      toast(j.ok ? tr(toAdmin ? 'admin.users.rolePromoted' : 'admin.users.roleDemoted') : tr(j.error || 'common.opFailed'));
      if (j.ok) emit('changed'); // 不关弹窗：头部徽标会立刻跟着变，看得见
    });
  });
}

const actions = computed(() => {
  const list = [
    { key: 'name', label: 'admin.users.changeName', danger: false, run: changeName },
    { key: 'pass', label: 'admin.users.changePass', danger: false, run: changePass },
    {
      key: 'avatar',
      label: props.user && props.user.image ? 'admin.users.avatarChange' : 'admin.users.avatarSet',
      danger: false,
      run: setAvatar
    },
    {
      key: 'role',
      label: props.user && props.user.role === 'admin' ? 'admin.users.roleDemote' : 'admin.users.rolePromote',
      danger: !!(props.user && props.user.role === 'admin'),
      run: changeRole
    }
  ];
  if (!isSelf.value) list.push({ key: 'del', label: 'admin.users.delBtn', danger: true, run: remove });
  return list;
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="user"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="emit('close')"
    >
      <div
        ref="rootEl"
        class="w-[min(400px,100%)] overflow-hidden rounded-2xl border border-line bg-panel shadow-(--shadow-pop)"
        role="dialog"
        aria-modal="true"
      >
        <!-- 头像上传：与本人头像同一套流程（只接受上传，不接受外链） -->
        <input ref="avatarInput" type="file" accept="image/*" class="hidden" @change="onAvatarPicked">

        <div class="flex items-center gap-3 border-b border-line px-5 py-4">
          <img
            v-if="user.image"
            :src="user.image"
            alt=""
            referrerpolicy="no-referrer"
            class="h-10 w-10 shrink-0 rounded-full object-cover"
          >
          <span
            v-else
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fill text-base font-semibold text-muted"
          >{{ user.name.slice(0, 1) }}</span>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="min-w-0 truncate text-[15px] font-semibold">{{ user.name }}</span>
              <span v-if="isSelf" class="shrink-0 text-[11px] text-muted">{{ tr('common.me') }}</span>
              <span v-if="user.role === 'admin'" class="shrink-0 text-[11px] text-primary">{{ tr('common.admin') }}</span>
            </div>
            <div class="mt-0.5 flex items-center gap-2 text-[11px]">
              <span :class="user.online ? 'text-primary' : 'text-muted'">
                {{ statusText(user) }}
              </span>
              <span v-if="created" class="text-muted">{{ created }}</span>
            </div>
          </div>

          <button
            type="button"
            class="shrink-0 text-2xl leading-none text-muted transition-colors hover:text-ink"
            :title="tr('common.close')"
            :aria-label="tr('common.close')"
            @click="emit('close')"
          >×</button>
        </div>

        <!-- 操作：竖排整行按钮，不再挤在列表行里 -->
        <div class="flex flex-col gap-1.5 p-4">
          <button
            v-for="a in actions"
            :key="a.key"
            type="button"
            class="w-full rounded-xl border border-line bg-fill px-3 py-2 text-left text-[13px] transition-colors"
            :class="a.danger
              ? 'hover:border-danger hover:text-danger'
              : 'hover:border-primary hover:text-primary'"
            @click="a.run"
          >{{ tr(a.label) }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
