import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// 取 mathjax-full 的真实版本号：仅用于把 PACKAGE_VERSION 定义掉（原因见下面 define 的注释）
const require = createRequire(import.meta.url);
const MATHJAX_VERSION: string = (() => {
  try {
    return (require('mathjax-full/package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();

/* ============================================================
 * CircleChat 前端构建配置
 *
 * 采用「手写 HTML 壳 + 构建产物」模式：
 *   - 页面 HTML 放在 public/（保持 /admin.html 等 URL 不变），
 *     因为后端对 /admin.html 做了管理员鉴权，改名会绕过保护；
 *   - 源码在 src/，产物输出到 public/dist/，HTML 只引用固定文件名。
 * 每迁移一个页面，在 input 里加一个入口即可。
 *
 * 注：用 .mts 而非 .ts，避免 Vite 把配置当 CommonJS 加载（项目 package.json
 * 目前没有 "type": "module"，以兼容既有脚本与工具）。
 * ============================================================ */

export default defineConfig({
  // HTML 与静态资源本就在 public/ 下由服务端直接提供，无需 Vite 复制
  publicDir: false,
  plugins: [vue(), tailwindcss()],
  define: {
    // mathjax-full 的 js/components/version.js 在未定义 PACKAGE_VERSION 时会执行
    //   eval('require') / eval('__dirname') 去读 package.json 取版本号。
    // 打包器改不了 eval 内部的标识符，浏览器里会抛 "require is not defined"，
    // 导致整个 mathjax 分块加载失败 → 公式静默退化成纯文本（页面控制台上只有
    // 一条被 catch 掉的错误，很难查）。构建期把它定义掉即可：那个分支成为死代码，
    // 会被摇树彻底移除（构建日志里的 [EVAL] 警告随之消失）。
    PACKAGE_VERSION: JSON.stringify(MATHJAX_VERSION)
  },
  build: {
    outDir: 'public/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        admin: 'src/main-admin.ts',
        login: 'src/main-login.ts',
        group: 'src/main-group.ts',
        chat: 'src/main-chat.ts'
      },
      output: {
        // 固定文件名（不带 hash），便于 HTML 壳直接引用。
        // 多个入口共用 Vue 与 src/styles/tailwind.css，因此会额外产出
        // 共享块 assets/tailwind.js 与 assets/tailwind.css：
        // 入口 JS 会自动 import 共享块，HTML 只需引用共享的那份 CSS。
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
});
