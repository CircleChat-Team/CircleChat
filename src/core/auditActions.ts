/* ============================================================
 * 审计动作 → 文案 key
 * 全局日志（管理面板）与群日志共用同一份映射，避免两处维护。
 * ============================================================ */

export const ACTION_KEYS: Record<string, string> = {
  'login': 'admin.action.login',
  'login.fail': 'admin.action.loginFail',
  'logout': 'admin.action.logout',
  'msg': 'admin.action.msg',
  'group.msg': 'admin.action.groupMsg',
  'dm.msg': 'admin.action.dmMsg',
  'recall': 'admin.action.recall',
  'group.recall': 'admin.action.groupRecall',
  'dm.recall': 'admin.action.dmRecall',
  'upload': 'admin.action.upload',
  'settings': 'admin.action.settings',
  'self.pass': 'admin.action.selfPass',
  'register': 'admin.action.register',
  'friend.request': 'admin.action.friendRequest',
  'friend.accept': 'admin.action.friendAccept',
  'admin.review.approve': 'admin.action.approve',
  'admin.review.reject': 'admin.action.reject',
  'admin.user.add': 'admin.action.userAdd',
  'admin.user.del': 'admin.action.userDel',
  'admin.user.pass': 'admin.action.userPass',
  'admin.user.role': 'admin.action.userRole',
  'admin.file.del': 'admin.action.fileDel',
  'group.create': 'admin.action.groupCreate',
  'group.dissolve': 'admin.action.groupDissolve',
  'group.join': 'admin.action.groupJoin',
  'group.leave': 'admin.action.groupLeave',
  'group.rename': 'admin.action.groupRename',
  'group.request': 'admin.action.groupRequest',
  'group.request.approve': 'admin.action.groupRequestApprove',
  'group.request.reject': 'admin.action.groupRequestReject',
  'group.announce': 'admin.action.groupAnnounce',
  'group.avatar': 'admin.action.groupAvatar',
  'group.file.del': 'admin.action.groupFileDel',
  'group.member.remove': 'admin.action.groupMemberRemove',
  'group.transfer': 'admin.action.groupTransfer',
  'login.2fa': 'admin.action.login2fa',
  'login.blocked': 'admin.action.loginBlocked',
  'msg.report': 'admin.action.msgReport',
  'user.image': 'admin.action.selfImage',
  'user.rename': 'admin.action.selfRename',
  'admin.user.image': 'admin.action.userImage',
  'admin.user.rename': 'admin.action.userRename',
  'mod.dismiss': 'admin.action.modDismiss',
  'mod.punish': 'admin.action.modPunish',
  'mod.revoke': 'admin.action.modRevoke',
  'mod.appeal': 'admin.action.modAppeal',
  'mod.appeal.approve': 'admin.action.modAppealApprove',
  'mod.appeal.reject': 'admin.action.modAppealReject',
  'twofa.setup': 'admin.action.twofaSetup',
  'twofa.enable': 'admin.action.twofaEnable',
  'twofa.disable': 'admin.action.twofaDisable',
  'oauth.login': 'admin.action.oauthLogin',
  'oauth.bind': 'admin.action.oauthBind',
  'oauth.unbind': 'admin.action.oauthUnbind',
  'oauth.config': 'admin.action.oauthConfig',
  'admin.captcha': 'admin.action.captcha',
  'admin.file.delBatch': 'admin.action.fileDelBatch',
  'key.create': 'admin.action.keyCreate',
  'key.update': 'admin.action.keyUpdate',
  'key.delete': 'admin.action.keyDelete'
};

/**
 * 动作分组：管理面板的筛选器按类别展示（可整类勾选，也可单项勾选）。
 * 分类只影响「筛选器的呈现」，不改变任何存储结构。
 * ⚠️ 每个 ACTION_KEYS 里的动作必须**恰好**落在一个组里，
 *    `tools/check-audit-groups.ts` 会校验（漏了就会被筛不出来）。
 */
export interface ActionGroup {
  key: string;
  label: string;
  actions: string[];
}

export const ACTION_GROUPS: ActionGroup[] = [
  {
    key: 'login',
    label: 'admin.logGroup.login',
    actions: ['login', 'login.fail', 'logout', 'login.2fa', 'login.blocked', 'register', 'self.pass', 'settings', 'user.image', 'user.rename']
  },
  {
    key: 'twofa',
    label: 'admin.logGroup.twofa',
    actions: ['twofa.setup', 'twofa.enable', 'twofa.disable']
  },
  {
    key: 'oauth',
    label: 'admin.logGroup.oauth',
    actions: ['oauth.login', 'oauth.bind', 'oauth.unbind', 'oauth.config']
  },
  {
    key: 'message',
    label: 'admin.logGroup.message',
    actions: ['msg', 'group.msg', 'dm.msg', 'recall', 'group.recall', 'dm.recall', 'upload', 'msg.report']
  },
  {
    key: 'friend',
    label: 'admin.logGroup.friend',
    actions: ['friend.request', 'friend.accept']
  },
  {
    key: 'group',
    label: 'admin.logGroup.group',
    actions: [
      'group.create', 'group.dissolve', 'group.join', 'group.leave', 'group.rename',
      'group.request', 'group.request.approve', 'group.request.reject', 'group.announce',
      'group.avatar', 'group.file.del', 'group.member.remove', 'group.transfer'
    ]
  },
  {
    key: 'admin',
    label: 'admin.logGroup.admin',
    actions: [
      'admin.review.approve', 'admin.review.reject', 'admin.user.add', 'admin.user.del',
      'admin.user.pass', 'admin.user.role', 'admin.user.image', 'admin.user.rename',
      'admin.file.del', 'admin.file.delBatch', 'admin.captcha'
    ]
  },
  {
    key: 'mod',
    label: 'admin.logGroup.mod',
    actions: ['mod.dismiss', 'mod.punish', 'mod.revoke', 'mod.appeal', 'mod.appeal.approve', 'mod.appeal.reject']
  },
  {
    key: 'key',
    label: 'admin.logGroup.key',
    actions: ['key.create', 'key.update', 'key.delete']
  }
];

/** 审计详情：新格式为 JSON {k: i18n 键, v: 变量}；旧版写死的中文原样显示 */
export function formatAuditDetail(
  d: string | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  if (!d) return '';
  try {
    const o = JSON.parse(d) as { k?: string; v?: Record<string, string | number> };
    if (o && typeof o === 'object' && typeof o.k === 'string') return t(o.k, o.v || {});
  } catch {
  }
  return d;
}
