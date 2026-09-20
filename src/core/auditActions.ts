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
  'twofa.setup': 'admin.action.twofaSetup',
  'twofa.enable': 'admin.action.twofaEnable',
  'twofa.disable': 'admin.action.twofaDisable'
};

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
    /* 旧版详情，原样显示 */
  }
  return d;
}
