/* ============================================================
 * 消息里的 Steam 商店链接 → 游戏卡片
 *
 * 与 GitHub 卡片同样的策略：按 appid + 当前语言共享响应式缓存，60 秒内不重复请求；
 * 服务端还有 10 分钟缓存与并发合并。
 * ============================================================ */
import { reactive } from 'vue';
import { get } from './api';
import { langState } from './i18n';

export interface SteamApp {
  appid: number;
  name: string;
  type: string;
  header: string;
  shortDescription: string;
  developers: string[];
  publishers: string[];
  genres: string[];
  releaseDate: string;
  comingSoon: boolean;
  free: boolean;
  price: string | null;
  initialPrice: string | null;
  discount: number;
  platforms: { windows: boolean; mac: boolean; linux: boolean };
  metacritic: number | null;
  html: string;
}

export interface SteamEntry {
  loading: boolean;
  data: SteamApp | null;
  /** 失败原因的 i18n 键（存键不存译文） */
  code: string;
  stale: boolean;
  at: number;
}

const CACHE_TTL = 60 * 1000;
/** 一条消息最多出几张游戏卡，避免刷屏 */
const MAX_PER_MESSAGE = 3;

const cache = reactive<Record<string, SteamEntry>>({});

/** 当前语言对应的 Steam 本地化代码 */
function steamLang(): string {
  const l = langState.lang;
  return l === 'zh' ? 'schinese' : l === 'ja' ? 'japanese' : 'english';
}

/**
 * 提取 store.steampowered.com/app/<id> 链接：去重、保持顺序、最多 MAX_PER_MESSAGE 个。
 * 代码块 / 行内代码里的链接不算（与 GitHub 卡片口径一致）。
 */
export function extractSteam(text: string): number[] {
  const raw = String(text || '');
  if (!raw || raw.indexOf('steampowered.com') === -1) return [];
  const src = raw.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const re =
    /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?store\.steampowered\.com\/app\/(\d{1,10})(?:[/?#][^\s]*)?/gi;
  const out: number[] = [];
  const seen = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const id = Number(m[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PER_MESSAGE) break;
  }
  return out;
}

/** 同步拿到（可能还在加载中的）缓存条目；组件重挂载也复用同一个请求 */
export function steamApp(appid: number): SteamEntry {
  const lang = steamLang();
  const key = appid + ':' + lang;
  const cur = cache[key];
  if (cur) {
    if (cur.loading || (cur.data && Date.now() - cur.at < CACHE_TTL)) return cur;
    if (cur.data) {
      void fetchApp(key, appid, lang);
      return cur;
    }
    return cur;
  }
  cache[key] = { loading: true, data: null, code: '', stale: false, at: 0 };
  void fetchApp(key, appid, lang);
  return cache[key];
}

async function fetchApp(key: string, appid: number, lang: string): Promise<void> {
  const slot = cache[key];
  slot.loading = true;
  try {
    const j = await get('/api/steam/app?appid=' + appid + '&lang=' + encodeURIComponent(lang));
    slot.data = (j.app as SteamApp) || null;
    slot.code = j.ok ? '' : String(j.error || 'steam.failed');
    slot.stale = !!j.stale;
    slot.at = Number(j.at) || Date.now();
  } catch {
    slot.data = null;
    slot.code = 'steam.failed';
  }
  slot.loading = false;
}
