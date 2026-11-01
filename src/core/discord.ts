/* ============================================================
 * 消息里的 Discord 邀请链接 → 服务器卡片
 *
 * 识别 discord.gg/<code> 与 discord.com/invite/<code>；数据由服务端代理
 * （服务端同时把服务器图标转成 data URL 返回），客户端按邀请码共享 60s 缓存。
 * ============================================================ */
import { reactive } from 'vue';
import { get } from './api';

export interface DiscordInvite {
  code: string;
  guildId: string;
  name: string;
  description: string;
  /** 服务端代理后的 data URL；取不到时为空串 */
  icon: string;
  members: number;
  online: number;
  channel: string;
  expiresAt: string;
  html: string;
}

export interface DiscordEntry {
  loading: boolean;
  data: DiscordInvite | null;
  code: string;
  stale: boolean;
  at: number;
}

const CACHE_TTL = 60 * 1000;
/** 一条消息最多出几张服务器卡 */
const MAX_PER_MESSAGE = 3;
/** 客户端缓存上限：每个条目可能带 data URL 图标 */
const MAX_CACHE = 200;

const cache = reactive<Record<string, DiscordEntry>>({});

function trimCache(): void {
  const keys = Object.keys(cache);
  while (keys.length > MAX_CACHE) {
    const k = keys.shift();
    if (k) delete cache[k];
  }
}

/**
 * 提取 Discord 邀请码：去重、保持顺序、最多 MAX_PER_MESSAGE 个。
 * 代码块 / 行内代码里的链接不算。
 */
export function extractDiscord(text: string): string[] {
  const raw = String(text || '');
  if (
    !raw ||
    (raw.indexOf('discord.gg') === -1 &&
      raw.indexOf('discord.com/invite') === -1 &&
      raw.indexOf('discordapp.com/invite') === -1)
  ) {
    return [];
  }
  const src = raw.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const re =
    /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/([A-Za-z0-9_-]{2,64})|discord(?:app)?\.com\/invite\/([A-Za-z0-9_-]{2,64}))/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const code = m[1] || m[2];
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= MAX_PER_MESSAGE) break;
  }
  return out;
}

/** 同步拿到（可能还在加载中的）缓存条目 */
export function discordInvite(code: string): DiscordEntry {
  const key = String(code || '');
  const cur = cache[key];
  if (cur) {
    if (cur.loading) return cur;
    if (cur.data && Date.now() - cur.at < CACHE_TTL) return cur;
    // 永久失败（邀请失效 / 不是服务器）不重试；临时失败 60s 后重试
    const permanent = cur.code === 'discord.notFound' || cur.code === 'discord.notGuild';
    if (!permanent && Date.now() - cur.at >= CACHE_TTL) void fetchInvite(key);
    return cur;
  }
  cache[key] = { loading: true, data: null, code: '', stale: false, at: 0 };
  trimCache();
  void fetchInvite(key);
  return cache[key];
}

async function fetchInvite(code: string): Promise<void> {
  const slot = cache[code];
  slot.loading = true;
  try {
    const j = await get('/api/discord/invite?code=' + encodeURIComponent(code));
    slot.data = (j.invite as DiscordInvite) || null;
    slot.code = j.ok ? '' : String(j.error || 'discord.failed');
    slot.stale = !!j.stale;
    slot.at = Number(j.at) || Date.now();
  } catch {
    slot.data = null;
    slot.code = 'discord.failed';
    slot.at = Date.now();
  }
  slot.loading = false;
}
