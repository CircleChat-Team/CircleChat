/* ============================================================
 * 消息里的 GitHub 链接 → 仓库卡片 / 详情弹窗
 *
 * 「基础信息只调一次接口」在客户端这一侧的落实方式：
 *  - 按仓库（owner/name）**共享一份响应式缓存**：同一条消息里出现两次、
 *    十个人各发一遍、上下滚动反复重挂载组件，都只会发一个请求；
 *  - 60 秒内直接用缓存（与参考实现一致），期间不重复打接口；
 *  - 详情是**点开弹窗才取**，而且弹窗里不再重复取仓库主信息（用卡片那份）。
 * ============================================================ */
import { reactive } from 'vue';
import { get } from './api';
import { lastSeenLabel } from './format';
import { tr, trn } from './i18n';
import type { RepoBasic, RepoDetail } from '../types';

// 纯逻辑（链接提取 / 数字格式化 / 语言配色）都在 repolink.ts，可脱离浏览器单测；
// 这里转出去，组件统一从 core/github 引入即可。
export {
  extractRepos,
  formatCount,
  formatSizeKb,
  langColor,
  fmtDay,
  LANG_COLORS,
  MAX_PER_MESSAGE
} from './repolink';

/** 客户端缓存时长：60 秒内不重复请求（服务端还有 10 分钟缓存兜着） */
const CACHE_TTL = 60 * 1000;

export interface RepoEntry<T> {
  loading: boolean;
  data: T | null;
  /** 失败原因的 i18n 文案键（**存键不存译文**：切换语言时已经取过的条目也要跟着变），空串表示没出错 */
  code: string;
  /** 数据来自服务端的过期缓存（GitHub 此刻不可用） */
  stale: boolean;
  at: number;
}

const basicCache = reactive<Record<string, RepoEntry<RepoBasic>>>({});
const detailCache = reactive<Record<string, RepoEntry<RepoDetail>>>({});

function emptyEntry<T>(): RepoEntry<T> {
  return { loading: true, data: null, code: '', stale: false, at: 0 };
}

/** 拉取基础信息；已有缓存 / 正在请求中就直接复用，不会重复发请求 */
export function repoBasic(full: string): RepoEntry<RepoBasic> {
  const key = String(full || '').toLowerCase();
  const cur = basicCache[key];
  if (cur) {
    // 新鲜就不动；过期的在已有数据时也先用着（后台静默刷新），避免卡片闪一下
    if (cur.loading || (cur.data && Date.now() - cur.at < CACHE_TTL)) return cur;
    if (cur.data) {
      void fetchBasic(key);
      return cur;
    }
    return cur;
  }
  basicCache[key] = emptyEntry<RepoBasic>();
  void fetchBasic(key);
  return basicCache[key];
}

/** 详情：只在弹窗打开时调用一次 */
export function repoDetail(full: string): RepoEntry<RepoDetail> {
  const key = String(full || '').toLowerCase();
  const cur = detailCache[key];
  if (cur) {
    if (cur.loading || (cur.data && Date.now() - cur.at < CACHE_TTL)) return cur;
    if (cur.data) {
      void fetchDetail(key);
      return cur;
    }
    return cur;
  }
  detailCache[key] = emptyEntry<RepoDetail>();
  void fetchDetail(key);
  return detailCache[key];
}

async function fetchBasic(key: string): Promise<void> {
  const slot = basicCache[key];
  slot.loading = true;
  try {
    const j = await get('/api/github/repo?repo=' + encodeURIComponent(key));
    slot.data = (j.repo as RepoBasic) || null;
    slot.code = j.ok ? '' : String(j.error || 'github.failed');
    slot.stale = !!j.stale;
    slot.at = Number(j.at) || Date.now();
  } catch {
    slot.data = null;
    slot.code = 'github.failed';
  }
  slot.loading = false;
}

async function fetchDetail(key: string): Promise<void> {
  const slot = detailCache[key];
  slot.loading = true;
  try {
    const j = await get('/api/github/repo/detail?repo=' + encodeURIComponent(key));
    slot.data = (j.detail as RepoDetail) || null;
    slot.code = j.ok ? '' : String(j.error || 'github.failed');
    slot.stale = !!j.stale;
    slot.at = Number(j.at) || Date.now();
  } catch {
    slot.data = null;
    slot.code = 'github.failed';
  }
  slot.loading = false;
}

/** ISO 时间 → 「3 小时前」这类文案（复用最后在线那套相对时间分档） */
export function timeAgoText(iso?: string | null): string {
  const t = iso ? Date.parse(iso) : 0;
  const l = lastSeenLabel(t);
  if (!l) return '';
  if (l.key === 'common.lastSeen.now') return tr('common.lastSeen.now');
  if (l.key === 'common.lastSeen.date') return tr('common.lastSeen.date', { date: l.date });
  return trn(l.key, l.n);
}
