import { handleHttp } from '../lib/runtime';

// 全量兜底路由：接管所有 method / path 的 HTTP 请求，原样转交回
// server/lib/runtime.ts 的 handleHttp（server.js 的 1:1 搬迁）。
// 说明：node-server 预设下 h3 的 fromNodeHandler 依赖 event.runtime.node，而该预设并未填充，
// 会抛 “Executing Node.js middleware is not supported in this server”。因此这里直接用
// event.node 暴露的原生 req/res，并等待响应真正结束（finish/close）后再 resolve，
// 避免 h3 在异步路由（登录 / 建群 / 上传等走 readBody 的路径）上重复发送响应。
export default defineEventHandler((event) => {
  const req = event.node.req;
  const res = event.node.res;

  try {
    handleHttp(req, res);
  } catch (err) {
    if (!res.headersSent) {
      try { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); } catch (e) {  }
    }
    if (!res.writableEnded) { try { res.end(); } catch (e) {  } }
    return;
  }

  return new Promise<void>((resolve) => {
    if (res.writableEnded) return resolve();
    const done = () => resolve();
    res.once('finish', done);
    res.once('close', done);
    res.once('error', done);
  });
});
