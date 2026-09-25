/* ============================================================
 * GitHub 仓库信息代理（消息里的仓库卡片 / 详情弹窗用）
 *
 * 为什么放在服务端：
 *  1. token 只在服务端用，前端拿不到；
 *  2. 同一个仓库被多个用户、多条消息引用时，只打一次 GitHub（进程内缓存 + 并发合并）；
 *  3. 未配置 token 时 GitHub 按小时限流（60 次/小时，且是**按服务器 IP** 算的，
 *     所有人共用这一份额度），所以必须有缓存和限流降级。
 *
 * 缓存策略：
 *  - 成功结果缓存 TTL_MS（10 分钟）；
 *  - **限流/失败时返回上一次的缓存**（stale），并带 stale 标记 —— 宁可显示稍旧的数据，
 *    也好过整个卡片变成错误提示；
 *  - 失败结果只缓存 FAIL_TTL_MS（1 分钟），避免限流期间被反复打。
 * ============================================================ */
import { get as cfgGet } from './appconfig';

const API = process.env.GITHUB_API_BASE || 'https://api.github.com';
const TTL_MS = 10 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 8000;
const HTTP = 'https://github.com';

/** owner/name：GitHub 用户名的上限是 39、仓库名 100；只允许合法字符（顺带挡住路径穿越） */
const FULL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export function isValidFull(full: string): boolean {
  return FULL_RE.test(String(full || ''));
}

export interface RepoCommit {
  sha: string;
  message: string;
  date: string;
  author: string;
  avatar: string | null;
  url: string;
}

/** 卡片用的基础信息（基础信息只用这一个接口返回，前端不会再为此打第二次） */
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
  /** 最近一次提交（REST 的仓库端点不带，需要单独取一次） */
  commit: RepoCommit | null;
  html: string;
}

export interface RepoDetail {
  contributors: { login: string; avatar: string; url: string; contributions: number }[];
  languages: Record<string, number>;
  release: { tag: string; name: string; url: string; publishedAt: string } | null;
  commits: RepoCommit[];
  /** 取失败的分块（contributors / languages / release / commits）——
     空数据有两种含义：仓库确实没有，还是这次没取到（多半是限流）。前端要能区分开 */
  failed: string[];
}

export interface RepoResult<T> {
  data: T | null;
  /** 出错原因码（前端按码出文案）：rate_limited / not_found / fetch_failed */
  error: string;
  /** 数据来自过期缓存（GitHub 此刻不可用） */
  stale: boolean;
  /** 缓存时间戳（前端显示「更新于」用） */
  at: number;
}

interface Entry {
  at: number;
  data: any;
  error: string;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<RepoResult<any>>>();

function token(): string {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || cfgGet('github.apiToken') || '';
}

/** 统一出网：把 GitHub 的状态码翻译成我们自己的错误码 */
async function ghGet(path: string): Promise<any> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'CircleChat'
  };
  const tk = token();
  if (tk) headers.Authorization = 'Bearer ' + tk;
  let res: Response;
  try {
    res = await fetch(API + path, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    // DNS / 连接被拒 / TLS / 超时都是这里：统一成 fetch_failed，
    // 不要把 ECONNREFUSED 这类原始错误码透出去（前端按码出文案）
    throw new Error('fetch_failed');
  }
  if (res.ok) return res.json();
  if (res.status === 404) throw new Error('not_found');
  // 403 也可能是「仓库被屏蔽」，但绝大多数情况是限流（未配 token 时每小时 60 次），
  // 按限流提示对用户更有指导性（会告诉他稍后再试，而不是让他以为仓库没了）
  if (res.status === 403 || res.status === 429) throw new Error('rate_limited');
  throw new Error('fetch_failed');
}

/**
 * 带缓存 + 并发合并的取数。
 * 同一个 key 同时被多个请求要时，只发一次真实请求（后到的等同一份 Promise）。
 */
async function withCache<T>(key: string, fn: () => Promise<T>): Promise<RepoResult<T>> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && !hit.error && now - hit.at < TTL_MS) {
    return { data: hit.data, error: '', stale: false, at: hit.at };
  }
  if (hit && hit.error && now - hit.at < FAIL_TTL_MS) {
    return { data: null, error: hit.error, stale: false, at: hit.at };
  }
  const busy = inflight.get(key);
  if (busy) return busy as Promise<RepoResult<T>>;

  const task = fn()
    .then((data) => {
      const at = Date.now();
      cache.set(key, { at, data, error: '' });
      return { data: data as T | null, error: '', stale: false, at };
    })
    .catch((e) => {
      const code = String((e && e.message) || 'fetch_failed');
      // 有旧数据就用旧的：限流时用户看到的仍是可用卡片，而不是一片错误
      if (hit && hit.data) return { data: hit.data as T | null, error: code, stale: true, at: hit.at };
      const at = Date.now();
      cache.set(key, { at, data: null, error: code });
      return { data: null, error: code, stale: false, at };
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, task as Promise<RepoResult<any>>);
  return task;
}

/* ---------- 原始数据 → 我们自己的结构 ---------- */

function toCommit(raw: any): RepoCommit | null {
  if (!raw || !raw.sha) return null;
  const c = raw.commit || {};
  return {
    sha: String(raw.sha),
    message: String((c.message || '').split('\n')[0] || ''),
    date: String((c.author && c.author.date) || ''),
    author: String((raw.author && raw.author.login) || (c.author && c.author.name) || ''),
    avatar: (raw.author && raw.author.avatar_url) || null,
    url: String(raw.html_url || '')
  };
}

function toBasic(raw: any, commit: any): RepoBasic {
  return {
    full: String(raw.full_name || ''),
    owner: String((raw.owner && raw.owner.login) || ''),
    name: String(raw.name || ''),
    description: raw.description ? String(raw.description) : null,
    stars: Number(raw.stargazers_count) || 0,
    forks: Number(raw.forks_count) || 0,
    watchers: Number(raw.subscribers_count) || 0,
    issues: Number(raw.open_issues_count) || 0,
    language: raw.language ? String(raw.language) : null,
    license: raw.license && raw.license.spdx_id ? String(raw.license.spdx_id) : null,
    sizeKb: Number(raw.size) || 0,
    topics: Array.isArray(raw.topics) ? raw.topics.map(String).slice(0, 12) : [],
    branch: String(raw.default_branch || 'main'),
    createdAt: raw.created_at ? String(raw.created_at) : null,
    pushedAt: raw.pushed_at ? String(raw.pushed_at) : null,
    commit: toCommit(commit),
    html: String(raw.html_url || HTTP + '/' + String(raw.full_name || ''))
  };
}

/**
 * 基础信息：仓库主信息 + 最近一次提交。
 * 前端为卡片只发一次请求；这里内部是 2 个 GitHub 请求（都各自走缓存，
 * 且没有「仓库 + 最新提交」的合并端点，REST 只能这么取）。
 */
export function repoBasic(full: string): Promise<RepoResult<RepoBasic>> {
  const key = 'basic:' + full.toLowerCase();
  return withCache<RepoBasic>(key, async () => {
    const [repo, commits] = await Promise.all([
      ghGet('/repos/' + full),
      // 最近提交拿不到不算致命：卡片少一行而已
      ghGet('/repos/' + full + '/commits?per_page=1').catch(() => null)
    ]);
    const one = Array.isArray(commits) ? commits[0] : commits && commits.sha ? commits : null;
    return toBasic(repo, one);
  });
}

/**
 * 详细信息（点开弹窗时才取）。
 * 单个端点失败不影响其余：参考实现就是这么做的（Promise.allSettled），
 * 仓库主信息已经在卡片里拿到，弹窗只补这几块。
 */
export function repoDetail(full: string): Promise<RepoResult<RepoDetail>> {
  const key = 'detail:' + full.toLowerCase();
  return withCache<RepoDetail>(key, async () => {
    const failed: string[] = [];
    const mark = (name: string) => (): null => {
      failed.push(name);
      return null;
    };
    const [contributors, languages, releases, commits] = await Promise.all([
      ghGet('/repos/' + full + '/contributors?per_page=20').catch(mark('contributors')),
      ghGet('/repos/' + full + '/languages').catch(mark('languages')),
      ghGet('/repos/' + full + '/releases?per_page=1').catch(mark('release')),
      ghGet('/repos/' + full + '/commits?per_page=15').catch(mark('commits'))
    ]);
    const rel = Array.isArray(releases) && releases[0] ? releases[0] : null;
    return {
      failed,
      contributors: (Array.isArray(contributors) ? contributors : [])
        .filter((c: any) => c && c.login)
        .map((c: any) => ({
          login: String(c.login),
          avatar: String(c.avatar_url || ''),
          url: String(c.html_url || ''),
          contributions: Number(c.contributions) || 0
        })),
      languages: languages && typeof languages === 'object' && !Array.isArray(languages) ? languages : {},
      release: rel
        ? {
            tag: String(rel.tag_name || ''),
            name: String(rel.name || ''),
            url: String(rel.html_url || ''),
            publishedAt: String(rel.published_at || '')
          }
        : null,
      commits: (Array.isArray(commits) ? commits : []).map(toCommit).filter(Boolean) as RepoCommit[]
    };
  });
}
