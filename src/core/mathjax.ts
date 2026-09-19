/* ============================================================
 * 数学公式渲染的「重量级实现」：仅当消息中出现公式时才会被动态加载
 * （见 core/math.ts 的门面）。TeX 输入 → 自包含 SVG 字符串（同步）。
 * ============================================================ */
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

/** 创建 TeX→SVG 渲染器（同步，无 DOM 依赖） */
export function createRenderer(): (tex: string, display: boolean) => string {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: AllPackages });
  const svg = new SVG({ fontCache: 'local' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: any = mathjax.document('', { InputJax: tex, OutputJax: svg });
  return (src: string, display: boolean): string => {
    const s = String(src || '').trim();
    if (!s) return '';
    try {
      const node = doc.convert(s, { display, em: 16, ex: 8, containerWidth: 800 });
      return adaptor.outerHTML(node);
    } catch {
      return '';
    }
  };
}
