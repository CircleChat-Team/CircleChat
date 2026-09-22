/* ============================================================
 * GitHub 仓库链接的解析与展示格式化（无任何依赖，便于单独跑测试）
 *
 * 只做两件事：从一段消息文本里认出仓库（owner/name），以及把数字/时间
 * 格式化成卡片要的样子。取数逻辑在 core/github.ts。
 * ============================================================ */

/** 一条消息里最多画几张卡片：防刷，一条消息塞 50 个链接不该打 50 次接口 */
export const MAX_PER_MESSAGE = 3;

/**
 * github.com/owner/name —— 后面的子路径（/issues/12、/blob/main/a.ts）会被自然截掉。
 * 前面的 `(?<![\w.-])` 很关键：没有它，`mygithub.com/a/b`、`foo.github.com/a/b`
 * 也会从中间匹到 `github.com/a/b`，凭空长出一张卡片。
 */
const REPO_RE = /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9._-]{0,38}))\/([A-Za-z0-9._-]{1,100})/gi;

/** 这些「第一段」是 GitHub 自己的页面路径，后面跟的不是仓库 */
const RESERVED_OWNERS = new Set([
  'about', 'account', 'apps', 'blog', 'careers', 'codespaces', 'collections', 'contact',
  'customer-stories', 'dashboard', 'discussions', 'education', 'enterprise', 'events',
  'explore', 'features', 'gist', 'home', 'issues', 'join', 'login', 'logout', 'marketplace',
  'mobile', 'new', 'notifications', 'open-source', 'organizations', 'orgs', 'partners',
  'premium', 'pricing', 'projects', 'pulls', 'pulse', 'readme', 'repositories', 'resources',
  'search', 'security', 'settings', 'site', 'solutions', 'sponsors', 'stars', 'team',
  'topics', 'trending', 'users', 'why-github', 'wiki'
]);

/** 去掉围栏代码块与行内代码：里面的链接多半是代码示例，不该长出卡片 */
function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

/**
 * 提取消息里的 GitHub 仓库：去重（大小写不敏感）、保持出现顺序、最多 MAX_PER_MESSAGE 个。
 * 返回 `owner/name`，不是完整 URL。
 */
export function extractRepos(text: string): string[] {
  const raw = String(text || '');
  if (!raw || raw.indexOf('github.com') === -1) return [];
  const src = stripCode(raw);
  const out: string[] = [];
  const seen = new Set<string>();
  REPO_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REPO_RE.exec(src)) !== null) {
    const owner = m[1];
    let name = m[2];
    if (RESERVED_OWNERS.has(owner.toLowerCase())) continue;
    if (name.toLowerCase().endsWith('.git')) name = name.slice(0, -4);
    if (!name) continue;
    const full = owner + '/' + name;
    const key = full.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(full);
    if (out.length >= MAX_PER_MESSAGE) break;
  }
  return out;
}

/** 1234 → 1.2k；12345 → 12k（与参考实现同一套口径） */
export function formatCount(n?: number | null): string {
  const v = Number(n) || 0;
  if (v >= 1000) {
    const k = v / 1000;
    return (k >= 10 ? Math.round(k) : Number(k.toFixed(1))) + 'k';
  }
  return String(v);
}

/** 仓库体积：GitHub 给的是 KB */
export function formatSizeKb(kb?: number | null): string {
  const v = Number(kb) || 0;
  return v >= 1024 ? (v / 1024).toFixed(1) + ' MB' : v + ' KB';
}

/** 常见语言的品牌色（占比条配色，与参考实现同一套） */
export const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  CSS: '#663399',
  HTML: '#e34c26',
  Python: '#3572A5',
  Shell: '#89e051',
  Java: '#b07219',
  Rust: '#dea584',
  Go: '#00ADD8',
  Vue: '#41b883',
  Dockerfile: '#384d54',
  Makefile: '#427819',
  Lua: '#000080',
  'C++': '#f34b7d',
  C: '#555555'
};

export function langColor(name: string): string {
  return LANG_COLORS[name] || '#8b949e';
}

/** ISO 时间 → 2026-09-22 */
export function fmtDay(iso?: string | null): string {
  const t = iso ? Date.parse(iso) : 0;
  if (!t) return '';
  const d = new Date(t);
  const p = (n: number): string => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
