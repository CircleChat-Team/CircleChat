/* ============================================================
 * 在线状态：网页端 / 桌面客户端
 *
 * 服务端在 WS 的 presence 消息与 /api/me 里下发 platforms：
 *   用户名 -> { web: boolean, client: boolean }
 * 同一个用户两端都连着时两个字段都为 true，前端据此显示「客户端 + 网页在线」。
 *
 * 抽成不依赖任何东西的小模块，聊天页（core/chat）与群管理页
 * （components/group/MembersCard）共用同一套判定，避免两处各写一遍。
 * ============================================================ */

/** 用户名 → 该用户在哪些端在线（同时在线时两个都为 true） */
export interface PresencePlatforms {
  [name: string]: { web: boolean; client: boolean };
}

/** 状态文案 key：用法 tr('common.' + key) */
export type StatusKey = 'away' | 'online' | 'online.web' | 'online.client' | 'online.both' | 'offline';

/**
 * 由「是否在线 / 是否离开 / 连接来源」得出状态文案 key。
 * 优先级：离线 > 离开 > 在线（区分网页端、客户端、两端同时在线）；
 * 拿不到来源信息时退回通用的「在线」，不臆断成某一端。
 */
export function presenceStatusKey(
  online: boolean,
  away: boolean,
  p?: { web?: boolean; client?: boolean } | null
): StatusKey {
  if (!online) return 'offline';
  if (away) return 'away';
  if (!p) return 'online';
  if (p.web && p.client) return 'online.both';
  return p.client ? 'online.client' : 'online.web';
}
