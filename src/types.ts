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
  /** 连接来源：网页端 / 桌面客户端（两端同时在线时都为 true）；离线为 null */
  platform?: { web: boolean; client: boolean } | null;
  /** 最后在线时间（ms），离线时用于显示「最后在线 x」 */
  lastSeen?: number | null;
}

/** 待审核注册申请（GET /api/admin/approvals） */
export interface ApprovalItem {
  name: string;
  created?: number | null;
}

/** 文件归类（GET /api/admin/files；由服务端按扩展名判定，见 server/lib/filetypes.ts） */
export type FileKind =
  | 'image' | 'code' | 'audio' | 'video' | 'font'
  | 'document' | 'ebook' | 'archive' | 'disk' | 'executable' | 'other';

/** 上传文件（GET /api/admin/files） */
export interface FileItem {
  name: string;
  origin: string;
  size: number;
  ts: number;
  kind: FileKind;
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
  announcement?: string | null;
}

/** 群成员（/api/groups/manage） */
export interface GroupMember {
  name: string;
  owner?: boolean;
  joined?: number | null;
  /** 最后在线时间（ms），离线时用于显示「最后在线 x」 */
  lastSeen?: number | null;
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

/** 处罚申诉（POST /api/appeal、GET /api/me/appeals、GET /api/admin/appeals） */
export interface AppealItem {
  id: number;
  /** 关联的处罚 id（处罚被删时可能为 null） */
  penalty_id?: number | null;
  user: string;
  /** 提交时那条处罚的类型快照 */
  type?: string | null;
  reason?: string | null;
  created?: number | null;
  status: string;
  handled_by?: string | null;
  handled_at?: number | null;
  /** 管理员处理备注（驳回理由等） */
  note?: string | null;
  /** 关联处罚的快照（管理端列表用，来自 LEFT JOIN） */
  penalty_type?: string | null;
  penalty_reason?: string | null;
  penalty_target?: string | null;
  penalty_created?: number | null;
  penalty_expires?: number | null;
  penalty_active?: boolean;
}

/** 聊天消息（GET /api/messages、WS 下发 msg） */
export interface ChatMessage {
  idx?: number;
  type: 'text' | 'image' | 'file' | 'video' | 'audio' | 'merge' | 'shake';
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

/** 合并转发中的单条记录（type: 'merge' 消息的 content 解析结果） */
/** GitHub 仓库的一次提交（GET /api/github/repo） */
export interface RepoCommit {
  sha: string;
  message: string;
  date: string;
  author: string;
  avatar: string | null;
  url: string;
}

/** GitHub 仓库基础信息（消息里的仓库卡片） */
export interface RepoBasic {
  full: string;
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  forks: number;
  watchers: number;
  issues: number;
  language: string | null;
  license: string | null;
  sizeKb: number;
  topics: string[];
  branch: string;
  createdAt: string | null;
  pushedAt: string | null;
  commit: RepoCommit | null;
  html: string;
}

/** GitHub 仓库详细信息（展开弹窗；GET /api/github/repo/detail） */
export interface RepoDetail {
  contributors: { login: string; avatar: string; url: string; contributions: number }[];
  languages: Record<string, number>;
  release: { tag: string; name: string; url: string; publishedAt: string } | null;
  commits: RepoCommit[];
  /** 取失败的分块（contributors / languages / release / commits），用于区分「没有」与「没取到」 */
  failed: string[];
}

/** 搜索命中的一条消息（GET /api/messages/search）；content 是截断过的片段 */
export interface SearchHit {
  idx: number;
  gid: string | null;
  dm: string | null;
  from: string;
  ts: number;
  content: string;
}

export interface MergeItem {
  from: string;
  type: 'text' | 'image' | 'file' | 'video' | 'audio';
  /** text 为文本内容；image/file 为 /uploads 地址 */
  content?: string;
  name?: string | null;
  size?: number | null;
}

/** 合并转发数据结构 */
export interface MergeData {
  title?: string;
  items: MergeItem[];
}

/** 在线/全部账号（侧栏） */
export interface ChatUser {
  name: string;
  online?: boolean;
  image?: string | null;
  role?: string;
  lastSeen?: number | null;
}

export interface Friend {
  name: string;
  online?: boolean;
  image?: string | null;
  lastSeen?: number | null;
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
  announcement?: string | null;
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
