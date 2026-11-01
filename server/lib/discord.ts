/* ============================================================
 * Discord 服务器邀请信息代理（消息里的 discord.gg/<code> 卡片）
 *
 * 为什么放服务端：
 *  1. Discord API 不带 CORS，浏览器直连会被拦；
 *  2. 同一条邀请在多人/多条消息里反复出现，进程内缓存 + 并发合并；
 *  3. **图标也由服务端代理**：拉取 CDN 图标后转成 data URL 一起返回，
 *     前端不用再发第二个请求，也不会有跨域/防盗链问题。
 *
 * 缓存策略与 GitHub/Steam 代理一致：成功 TTL 10 分钟；失败/限流有旧数据时
 * 返回 stale，避免卡片直接变成错误块。
 * ============================================================ */

const API = 'https://discord.com/api/v10';
const CDN = 'https://cdn.discordapp.com/icons';
const TTL_MS = 10 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 8000;
/** 图标体积上限：转 data URL 后不宜太大 */
const MAX_ICON_BYTES = 64 * 1024;
/** 缓存条数上限：每条可能带 data URL 图标，必须设上限防止内存无限增长 */
const MAX_CACHE = 300;

/** 邀请码：字母数字 + _-，2~64 位 */
export function isValidCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{2,64}$/.test(String(code || ''));
}

export interface DiscordInvite {
  code: string;
  guildId: string;
  name: string;
  description: string;
  /** 已代理成 data URL；取不到时为空串 */
  icon: string;
  members: number;
  online: number;
  channel: string;
  expiresAt: string;
  html: string;
}

export interface DiscordResult {
  data: DiscordInvite | null;
  /** not_found / not_guild / rate_limited / fetch_failed */
  error: string;
  stale: boolean;
  at: number;
}

interface Entry {
  at: number;
  data: DiscordInvite | null;
  error: string;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<DiscordResult>>();

/** 写缓存并淘汰最旧的条目（Map 保持插入顺序） */
function remember(key: string, entry: Entry): void {
  cache.set(key, entry);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 代理图标：CDN → data URL（失败返回空串，卡片用占位） */
async function iconDataUrl(guildId: string, hash: string): Promise<string> {
  const ext = /^a_/i.test(hash) ? 'gif' : 'png';
  const url = CDN + '/' + guildId + '/' + hash + '.' + ext + '?size=128';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return '';
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    if (!/^image\//.test(type)) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_ICON_BYTES) return '';
    return 'data:' + type.split(';')[0] + ';base64,' + buf.toString('base64');
  } catch {
    return '';
  }
}

async function fetchInvite(code: string): Promise<DiscordInvite> {
  let res: Response;
  try {
    res = await fetch(
      API + '/invites/' + encodeURIComponent(code) + '?with_counts=true&with_expiration=true',
      { headers: { Accept: 'application/json', 'User-Agent': 'CircleChat' }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
  } catch {
    throw new Error('fetch_failed');
  }
  if (res.status === 404 || res.status === 403) throw new Error('not_found');
  if (res.status === 429) throw new Error('rate_limited');
  if (!res.ok) throw new Error('fetch_failed');

  const raw: any = await res.json();
  const g = raw && raw.guild;
  // 没有 guild 说明是群 DM / 好友邀请，不是服务器——不画服务器卡
  if (!g || !g.id || !g.name) throw new Error('not_guild');

  const guildId = String(g.id);
  const hash = g.icon ? String(g.icon) : '';
  const icon = hash ? await iconDataUrl(guildId, hash) : '';

  return {
    code,
    guildId,
    name: String(g.name),
    description: g.description ? String(g.description) : '',
    icon,
    members: Number(raw.approximate_member_count) || 0,
    online: Number(raw.approximate_presence_count) || 0,
    channel: raw.channel && raw.channel.name ? String(raw.channel.name) : '',
    expiresAt: raw.expires_at ? String(raw.expires_at) : '',
    html: 'https://discord.gg/' + code
  };
}

/** 带缓存 + 并发合并 */
async function withCache(key: string, fn: () => Promise<DiscordInvite>): Promise<DiscordResult> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && !hit.error && hit.data && now - hit.at < TTL_MS) {
    return { data: hit.data, error: '', stale: false, at: hit.at };
  }
  if (hit && hit.error && now - hit.at < FAIL_TTL_MS) {
    return { data: null, error: hit.error, stale: false, at: hit.at };
  }
  const busy = inflight.get(key);
  if (busy) return busy;

  const task = fn()
    .then((data) => {
      const at = Date.now();
      remember(key, { at, data, error: '' });
      return { data, error: '', stale: false, at };
    })
    .catch((e) => {
      const code = String((e && e.message) || 'fetch_failed');
      if (hit && hit.data) return { data: hit.data, error: code, stale: true, at: hit.at };
      const at = Date.now();
      remember(key, { at, data: null, error: code });
      return { data: null, error: code, stale: false, at };
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

export function discordInvite(code: string): Promise<DiscordResult> {
  const c = String(code || '').trim();
  if (!isValidCode(c)) {
    return Promise.resolve({ data: null, error: 'not_found', stale: false, at: Date.now() });
  }
  return withCache(c, () => fetchInvite(c));
}
