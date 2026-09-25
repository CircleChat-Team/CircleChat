/* ============================================================
 * 数学公式渲染的「重量级实现」：仅当消息中出现公式时才会被动态加载
 * （见 core/math.ts 的门面）。TeX 输入 → 自包含 SVG 字符串（同步）。
 *
 * ⚠️ 公式「不渲染、只显示纯文本」的坑（踩过一次，改动前务必看这里）：
 *    mathjax-full 的 js/components/version.js 在未定义 PACKAGE_VERSION 时会执行
 *      var load = eval('require'); var dirname = eval('__dirname');
 *    去读自己的 package.json 拿版本号。打包器改不了 eval 内部的标识符，浏览器里
 *    这段会抛 "require is not defined" → 整个 mathjax 分块加载失败 → 门面的
 *    renderMath 永远返回 '' → 公式一直退化成纯文本（错误还被 catch 吞掉，很难查）。
 *    真正的修法在 vite.config.mts：构建期 define 掉 PACKAGE_VERSION，那个分支
 *    就成了死代码被摇树移除（构建日志里的 [EVAL] 警告也会随之消失）。
 *    所以这里**必须**用官方的 `mathjax` 全局实例：它和 RegisterHTMLHandler
 *    注册 handler 用的是同一份 HandlerList；自己 new 一个 HandlerList 会报
 *    "Can't find handler for document"。
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
