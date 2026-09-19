import http from 'node:http';
import type { IncomingMessage, Duplex } from 'node:http';
import { handleWsUpgrade } from '../lib/runtime';

// 挂接 WebSocket 升级处理（server.js 的 1:1 搬迁）。
//
// 说明：本版本 Nitro 不发出 'listen' 钩子，无法直接拿到 http.Server 实例来挂 upgrade；
// 而 WebSocket 升级请求若只由 h3 的 request 处理，会被误当作普通请求（静态/路由），无法握手。
// 做法：在 http.Server 原型上拦截 'request' 监听的注册（Nitro 启动时构造服务器会注册 h3 的
// request 处理），同时挂接一次 upgrade 监听。一旦 http.Server 上存在 upgrade 监听，Node 会自动
// 把升级请求交给它而非 h3 的 request 处理，从而由 handleWsUpgrade 完成 RFC6455 握手。
// 此插件在 app 初始化时执行，早于服务器构造，故原型覆写一定先就位。
export default defineNitroPlugin(() => {
  const ServerProto = http.Server.prototype as unknown as {
    on(event: string, listener: (...args: any[]) => void, ...rest: any[]): any;
    __ccUpgradeAttached?: boolean;
  };
  if (!ServerProto.__ccUpgradeAttached) {
    const origOn = ServerProto.on;
    ServerProto.on = function (this: any, event: string, listener: (...args: any[]) => void, ...rest: any[]) {
      if (event === 'request' && !this.__ccUpgradeAttached) {
        this.__ccUpgradeAttached = true;
        origOn.call(this, 'upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
          handleWsUpgrade(req, socket, head);
        });
      }
      return origOn.call(this, event, listener, ...rest);
    };
  }
});
