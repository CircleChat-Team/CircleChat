/* ============================================================
 * Mermaid 图表渲染（门面）
 *
 * 体积很大（打包后是独立分块，约 1MB+），所以**按需动态加载**：
 * 只有消息里真的出现 ```mermaid 代码块时才会去请求这个分块，首屏不受影响。
 *
 * 与公式（core/math.ts）的差别：mermaid 渲染是**异步**的、且依赖真实 DOM
 * （要量文字尺寸才能布局），所以不能像 MathJax 那样同步返回 SVG 字符串。
 * 这里提供 Promise 版渲染，调用方在 DOM 更新后把返回的 SVG 填进占位节点。
 * ============================================================ */

/** mermaid 主题名（跟随站点深浅色） */
type MermaidTheme = 'dark' | 'default';

interface MermaidApi {
  initialize: (cfg: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
}

let api: MermaidApi | null = null;
let loading: Promise<MermaidApi | null> | null = null;
/** 当前已用哪套主题初始化过；切主题需要重新 initialize 并重画 */
let curTheme: MermaidTheme | null = null;

function load(): Promise<MermaidApi | null> {
  if (api) return Promise.resolve(api);
  if (!loading) {
    loading = import('mermaid')
      .then((m) => {
        api = ((m as { default?: unknown }).default || m) as unknown as MermaidApi;
        return api;
      })
      .catch((err) => {
        // 静默吞掉会把「图表不渲染」变成没有线索的故障（mathjax 踩过同样的坑），
        // 这里留一条明确日志，调用方则降级为显示源码。
        loading = null;
        console.error('[mermaid] 渲染模块加载失败，图表将以源码显示：', err);
        return null;
      });
  }
  return loading;
}

/**
 * 把一段 mermaid 源码渲染成 SVG 字符串。
 * @param id    mermaid 要求节点 id 全局唯一，由调用方生成
 * @param dark  是否深色主题（mermaid 的主题是全局配置，切换时会重新 initialize）
 * @returns SVG 字符串；加载失败或语法错误时返回 ''（由调用方降级为显示源码）
 */
export async function renderMermaid(code: string, id: string, dark: boolean): Promise<string> {
  const src = String(code || '').trim();
  if (!src) return '';
  const mod = await load();
  if (!mod) return '';
  const theme: MermaidTheme = dark ? 'dark' : 'default';
  if (curTheme !== theme) {
    mod.initialize({
      startOnLoad: false,
      // strict：标签里的 HTML 会被净化、禁用点击回调，避免消息内容注入脚本
      securityLevel: 'strict',
      theme,
      fontFamily: 'inherit',
      // 语法错误时不要往页面里塞 mermaid 自带的报错图，我们在占位节点上自己提示
      suppressErrorRendering: true
    });
    curTheme = theme;
  }
  try {
    const out = await mod.render(id, src);
    return out && typeof out.svg === 'string' ? out.svg : '';
  } catch (err) {
    // 语法错误是用户输入导致的常见情况，用 warn 而不是 error
    console.warn('[mermaid] 图表渲染失败（语法错误？）：', err);
    return '';
  }
}
