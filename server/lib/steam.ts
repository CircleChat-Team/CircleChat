/* ============================================================
 * Steam 商店应用信息代理（消息里的 store.steampowered.com/app/N 卡片）
 *
 * 为什么放服务端：
 *  1. Steam 的 appdetails 接口不带 CORS，浏览器直连会被拦；
 *  2. 同一款游戏在多人/多条消息里反复出现，进程内缓存 + 并发合并只打一次；
 *  3. 按语言/区域取本地化名称、简介与价格（l=schinese/english/japanese，cc=cn/jp/us）。
 *
 * 缓存策略与 GitHub 代理一致：成功 TTL 10 分钟；失败/限流时若有旧数据就返回
 * stale，避免卡片直接变成错误块。
 * ============================================================ */

const API = process.env.STEAM_API_BASE || 'https://store.steampowered.com/api/appdetails';
const TTL_MS = 10 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 8000;

export type SteamLang = 'schinese' | 'english' | 'japanese';

export function normalizeSteamLang(v: string): SteamLang {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'schinese' || s === 'english' || s === 'japanese') return s;
  return 'english';
}

export interface SteamApp {
  appid: number;
  name: string;
  type: string;
  /** 商店头图（460×215） */
  header: string;
  shortDescription: string;
  developers: string[];
  publishers: string[];
  genres: string[];
  releaseDate: string;
  comingSoon: boolean;
  free: boolean;
  /** 折后价（已格式化）；无价格时为 null */
  price: string | null;
  initialPrice: string | null;
  /** 折扣百分比，0 表示没打折 */
  discount: number;
  platforms: { windows: boolean; mac: boolean; linux: boolean };
  metacritic: number | null;
  html: string;
}

export interface SteamResult {
  data: SteamApp | null;
  /** fetch_failed / not_found / rate_limited */
  error: string;
  stale: boolean;
  at: number;
}

interface Entry {
  at: number;
  data: SteamApp | null;
  error: string;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<SteamResult>>();

function toApp(raw: any, appid: number): SteamApp | null {
  if (!raw || !raw.name) return null;
  const p = raw.price_overview || {};
  const list = (v: any): string[] =>
    Array.isArray(v) ? v.map((x: any) => String((x && x.description) || x || '')).filter(Boolean) : [];
  return {
    appid,
    name: String(raw.name || ''),
    type: String(raw.type || ''),
    header: String(raw.header_image || raw.capsule_image || ''),
    shortDescription: String(raw.short_description || ''),
    developers: Array.isArray(raw.developers) ? raw.developers.map((x: any) => String(x)) : [],
    publishers: Array.isArray(raw.publishers) ? raw.publishers.map((x: any) => String(x)) : [],
    genres: list(raw.genres),
    releaseDate: String((raw.release_date && raw.release_date.date) || ''),
    comingSoon: !!(raw.release_date && raw.release_date.coming_soon),
    free: !!raw.is_free,
    price: p.final_formatted ? String(p.final_formatted) : null,
    initialPrice: p.initial_formatted ? String(p.initial_formatted) : null,
    discount: Number(p.discount_percent) || 0,
    platforms: {
      windows: !!(raw.platforms && raw.platforms.windows),
      mac: !!(raw.platforms && raw.platforms.mac),
      linux: !!(raw.platforms && raw.platforms.linux)
    },
    metacritic: raw.metacritic && raw.metacritic.score ? Number(raw.metacritic.score) : null,
    html: 'https://store.steampowered.com/app/' + appid
  };
}

async function fetchApp(appid: number, lang: SteamLang): Promise<SteamApp> {
  const cc = lang === 'schinese' ? 'cn' : lang === 'japanese' ? 'jp' : 'us';
  const url = API + '?appids=' + appid + '&l=' + lang + '&cc=' + cc;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'CircleChat' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new Error('fetch_failed');
  }
  if (res.status === 429) throw new Error('rate_limited');
  if (!res.ok) throw new Error('fetch_failed');
  const j: any = await res.json();
  const item = j && j[String(appid)];
  if (!item || !item.success || !item.data) throw new Error('not_found');
  const app = toApp(item.data, appid);
  if (!app) throw new Error('not_found');
  return app;
}

/** 带缓存 + 并发合并：同一 appid + 语言同时被多人要时只发一次真实请求 */
async function withCache(key: string, fn: () => Promise<SteamApp>): Promise<SteamResult> {
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
      cache.set(key, { at, data, error: '' });
      return { data, error: '', stale: false, at };
    })
    .catch((e) => {
      const code = String((e && e.message) || 'fetch_failed');
      if (hit && hit.data) return { data: hit.data, error: code, stale: true, at: hit.at };
      const at = Date.now();
      cache.set(key, { at, data: null, error: code });
      return { data: null, error: code, stale: false, at };
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

export function steamApp(appid: number, lang: SteamLang): Promise<SteamResult> {
  const id = Math.floor(Number(appid));
  if (!Number.isFinite(id) || id <= 0) {
    return Promise.resolve({ data: null, error: 'not_found', stale: false, at: Date.now() });
  }
  const key = id + ':' + lang;
  return withCache(key, () => fetchApp(id, lang));
}
