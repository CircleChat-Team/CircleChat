/* ============================================================
 * 数学公式渲染（门面）：MathJax 体积较大，改为按需动态加载——
 * 仅当消息中出现公式时才加载 mathjax-full 分块，避免拖慢首屏。
 * 加载完成前先把公式降级为原文，加载后由 mathReady 触发重渲染。
 * ============================================================ */
import { ref } from 'vue';

/** 加载完成后置为 true，供渲染层建立响应式依赖以重新渲染 */
export const mathReady = ref(false);

let renderer: ((tex: string, display: boolean) => string) | null = null;
let loading = false;

/** 将 TeX 渲染为 SVG HTML 字符串；未就绪或失败时返回 ''（由调用方降级为原文） */
export function renderMath(tex: string, display: boolean): string {
  const src = String(tex || '').trim();
  if (!src) return '';
  if (renderer) return renderer(src, display);
  if (!loading) {
    loading = true;
    void import('./mathjax')
      .then((m) => {
        renderer = m.createRenderer();
        mathReady.value = true;
      })
      .catch((err) => {
        // 静默吞掉会把「公式不渲染」变成没有线索的故障，这里留一条明确日志
        // （历史踩坑：mathjax 分块加载失败 → 公式一直显示纯文本，查了很久）
        loading = false;
        console.error('[math] 公式渲染模块加载失败，公式将以纯文本显示：', err);
      });
  }
  return '';
}
