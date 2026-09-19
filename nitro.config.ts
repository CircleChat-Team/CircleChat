import { defineNitroConfig } from 'nitropack';

// CircleChat — Nitro 入口外壳（lift-and-shift）
// 不引入 Nitro 原生路由重写；全部 HTTP 经 routes/[...].ts 的 fromNodeHandler 兜底，
// WebSocket 经 plugins/ws.ts 的 listen 钩子挂到 upgrade，启动初始化在 plugins/bootstrap.ts。
export default defineNitroConfig({
  // 输出 node 独立服务：.output/server/index.mjs
  preset: 'node-server',
  // Nitro 的源码根：routes / plugins / middleware 均在此目录下
  srcDir: 'server',
  // 关闭 Nitro 内置静态服务：静态文件由 server/lib/runtime.ts 的 serveStatic 逐字服务，
  // 与原 server.js 行为一致（路径穿越防护 / gzip / MIME / index.html 兜底）。
  serveStatic: false,
  compatibilityDate: '2025-01-01',
  // Node 内置模块（node:sqlite / node:fs 等）保持外部化，不加进 bundle
  externals: {
    external: ['node:sqlite', 'node:fs', 'node:path', 'node:crypto', 'node:zlib', 'node:net', 'node:url'],
  },
  typescript: {
    strict: false,
  },
});
