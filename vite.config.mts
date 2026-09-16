import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

/* ============================================================
 * CircleChat 前端构建配置
 *
 * 采用「手写 HTML 壳 + 构建产物」模式：
 *   - 页面 HTML 放在 public/（保持 /admin.html 等 URL 不变），
 *     因为 server.js 对 /admin.html 做了管理员鉴权，改名会绕过保护；
 *   - 源码在 src/，产物输出到 public/dist/，HTML 只引用固定文件名。
 * 每迁移一个页面，在 input 里加一个入口即可。
 *
 * 注：用 .mts 而非 .ts，避免 Vite 把配置当 CommonJS 加载（项目 package.json
 * 没有 "type": "module"，因为 server.js 仍是 CommonJS）。
 * ============================================================ */

export default defineConfig({
  // HTML 与静态资源本就在 public/ 下由服务端直接提供，无需 Vite 复制
  publicDir: false,
  plugins: [vue(), tailwindcss()],
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
