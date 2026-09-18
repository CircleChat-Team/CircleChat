/* ============================================================
 * CircleChat 前端 — 共享类型
 * 与服务端 /api 返回结构对应；error 字段是 i18n 文案键而非中文。
 * ============================================================ */

/** 所有接口的通用返回外壳 */
export interface ApiResult {
  ok: boolean;
  /** 失败时的文案（i18n 键，也可能是服务端直出的中文） */
  error?: string;
  /** 成功时的提示文案键 */
  message?: string;
  [key: string]: unknown;
}

/** 账号（GET /api/admin/users） */
export interface UserItem {
  name: string;
  role: 'admin' | 'user';
  status?: string;
  created?: number | null;
  image?: string | null;
  online?: boolean;
}

/** 待审核注册申请（GET /api/admin/approvals） */
export interface ApprovalItem {
  name: string;
  created?: number | null;
}

/** 上传文件（GET /api/admin/files） */
export interface FileItem {
  name: string;
  origin: string;
  size: number;
  ts: number;
  kind: 'image' | 'file';
  used: number;
}

/** 审计日志条目（GET /api/admin/logs） */
export interface LogItem {
  id?: number;
  ts: number;
  actor?: string;
  action: string;
  target?: string | number;
  detail?: string;
  ip?: string;
}

/** 语言项（I18N.languages()） */
export interface LangItem {
  code: string;
  name: string;
}

/** 群（GET /api/groups、/api/groups/all） */
export interface GroupItem {
  id: string;
  name: string;
  owner: string;
  created?: number | null;
  members?: number;
  avatar?: string | null;
}

/** 群成员（/api/groups/manage） */
export interface GroupMember {
  name: string;
  owner?: boolean;
  joined?: number | null;
}

/** 入群申请（/api/groups/manage） */
export interface JoinRequest {
  name: string;
  created?: number | null;
}

/** 群内图片 / 文件（/api/groups/manage） */
export interface GroupFile {
  idx: number;
  type: 'image' | 'file';
  name?: string | null;
  size?: number | null;
  ts?: number | null;
  content?: string;
}

/** 群管理详情（GET /api/groups/manage?gid=） */
export interface GroupDetail {
  group: GroupItem;
  isOwner?: boolean;
  requests: JoinRequest[];
  members: GroupMember[];
  files: GroupFile[];
}

/** 消息举报（GET /api/admin/reports） */
export interface ReportItem {
  id: number;
  msg_idx: number;
  msg_from?: string | null;
  msg_type?: string | null;
  msg_snippet?: string | null;
  reason?: string | null;
  reporter?: string | null;
  reported_ip?: string | null;
  created?: number | null;
  status?: string | null;
}

/** 处罚（GET /api/admin/penalties） */
export interface PenaltyItem {
  id: number;
  type: string;
  target: string;
  reason?: string | null;
  actor?: string | null;
  created?: number | null;
  expires?: number | null;
  duration_ms?: number | null;
  active?: boolean;
  permanent?: boolean;
  revoked?: boolean;
  revoked_by?: string | null;
  revoked_at?: number | null;
}

/** 聊天消息（GET /api/messages、WS 下发 msg） */
export interface ChatMessage {
  idx?: number;
  type: 'text' | 'image' | 'file';
  from: string;
  to?: string;
  gid?: string | null;
  dm?: string | null;
  content: string;
  name?: string | null;
  size?: number | null;
  ts?: number;
  time?: number;
  replyTo?: number | null;
  reply?: {
    idx: number;
    from: string;
    snippet: string;
    type?: string;
    name?: string | null;
  } | null;
  at?: string[] | null;
  reactions?: { emoji: string; users: string[] }[] | null;
  recalled?: number;
  recalled_by?: string;
  file_expired?: boolean;
  /** 该文本消息是否按 Markdown 渲染 */
  md?: number;
  [key: string]: unknown;
}

/** 在线/全部账号（侧栏） */
export interface ChatUser {
  name: string;
  online?: boolean;
  image?: string | null;
  role?: string;
}

export interface Friend {
  name: string;
  online?: boolean;
  image?: string | null;
}

export interface FriendRequest {
  from: string;
  created?: number | null;
}

export interface FriendSent {
  to: string;
  created?: number | null;
}

/** 群（侧栏会话） */
export interface ChatGroup {
  id: string;
  name: string;
  owner: string;
  created?: number | null;
  members?: number;
  avatar?: string | null;
}

/** 用户资料卡（GET /api/profile） */
export interface ProfileData {
  name: string;
  role: string;
  created?: number | null;
  image?: string | null;
  online?: boolean;
  msgs?: number;
}
