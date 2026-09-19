/* ============================================================
 * ChatPlus 私人聊天 — highlight.js 浏览器包入口
 * （第三方署名由 esbuild 的 --banner 注入到产物开头）
 * 版权 © 2026 Ctoy && EndlessPixel。
 *
 * 用途：以本文件为入口，把 highlight.js 的
 *       「common」语言集（约 35 种常见语言）打包成单文件放到
 *       public/vendor/highlight.min.js，供聊天页代码块高亮使用。
 *       重建命令见文件末尾注释。
 *
 * 为什么不用 CDN / 原生 ESM：
 *   - 本项目的约定是「前端无任何外部 CDN 资源」，所有资源必须自托管；
 *   - highlight.js 的 es/ 目录只是 lib/ 的 ESM 包装，而 lib/ 是 CJS，
 *     浏览器无法直接加载，因此需要打包成 IIFE 单文件。
 *
 * 为什么用 common 而不是全部语言：全部语言 190+ 种、体积翻数倍，
 * 实际聊天场景用不到；common 已覆盖 js/ts/python/java/go/rust/sql/
 * shell/xml/css/yaml 等常用语言。需要更多语言时改这里再重新构建即可。
 * ============================================================ */

import hljs from 'highlight.js/lib/common';

// 暴露给聊天页脚本（chat.js 会检测 window.hljs 是否存在，缺失时自动降级为纯文本）
window.hljs = hljs;

// 重建 public/vendor/highlight.min.js（在项目根执行；--banner 注入第三方署名）：
// npx esbuild tools/hljs-entry.mjs --bundle --minify --format=iife --legal-comments=inline --banner:js="/*! highlight.js v11.12.0 | (c) 2006-2024 Josh Goebel and other contributors | BSD-3-Clause | https://github.com/highlightjs/highlight.js | 完整许可证: public/vendor/highlight.LICENSE.txt */" --outfile=public/vendor/highlight.min.js
