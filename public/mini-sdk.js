/* ============================================================
 * CircleChat 小程序 SDK（运行在 sandbox="allow-scripts" 的 iframe 内）
 *
 * 小程序是纯前端静态页面：没有独立进程、不占端口、无文件系统权限。
 * 所有数据通过平台 API 读写，与宿主页面的通信全部走 postMessage。
 *
 * 用法：
 *   <script src="/mini-sdk.js"></script>
 *   const cc = await CircleChat.ready();
 *   await CircleChat.sendMessage('大家好');
 *   await CircleChat.kv.set('note', '内容');
 * ============================================================ */
(function () {
  'use strict';

  var PROTO = 'circlechat-mini';
  var RPC_TIMEOUT = 15000;

  var ctx = null;
  var token = '';
  var expires = 0;
  var apiBase = '';
  var seq = 0;
  var waiters = {};
  var handlers = {};
  var readyPromise = null;

  // SDK 自身是从平台加载的，据此推断 API 地址（沙箱内是不透明源，无法用 location）
  try {
    var cur = document.currentScript;
    if (cur && cur.src) apiBase = new URL(cur.src).origin;
  } catch (e) {
    apiBase = '';
  }

  function post(msg) {
    try {
      parent.postMessage({ __cc: PROTO, payload: msg }, '*');
    } catch (e) {
      /* 宿主已卸载时静默 */
    }
  }

  function emit(name, data) {
    var list = handlers[name] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { console.error('[mini-sdk] 事件回调出错', e); }
    }
  }

  function rpc(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      waiters[id] = { resolve: resolve, reject: reject };
      post({ type: 'rpc', id: id, method: method, params: params || {} });
      setTimeout(function () {
        if (waiters[id]) {
          delete waiters[id];
          reject(new Error('timeout: ' + method));
        }
      }, RPC_TIMEOUT);
    });
  }

  /** 直连平台 API（同源 fetch + 会话派生的短时令牌），失败自动退回 postMessage 代理 */
  function request(method, params) {
    var p = params || {};
    if (!token || !apiBase) return rpc(method, p);
    return direct(method, p).catch(function () {
      return rpc(method, p);
    });
  }

  function qs(obj) {
    var out = [];
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) {
        out.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
      }
    }
    return out.length ? '?' + out.join('&') : '';
  }

  function callApi(path, opts) {
    var o = opts || {};
    var init = {
      method: o.method || 'GET',
      headers: { 'X-Mini-Token': token }
    };
    if (o.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(o.body);
    }
    return fetch(apiBase + path, init).then(function (r) {
      return r.json();
    }).then(function (j) {
      if (j && j.ok) return j;
      throw new Error((j && j.error) || 'request failed');
    });
  }

  /** 与后端 /api/mini/* 端点一一对应的直连路径 */
  function direct(method, p) {
    if (!ctx) return Promise.reject(new Error('not ready'));
    var base = { appId: ctx.appId, scope: ctx.scope, scopeId: ctx.scopeId };
    switch (method) {
      case 'kv.get':
        return callApi('/api/mini/kv' + qs(Object.assign({}, base, { k: p.key })));
      case 'kv.list':
        return callApi('/api/mini/kv' + qs(base));
      case 'kv.set':
        return callApi('/api/mini/kv', { method: 'POST', body: Object.assign({}, base, { k: p.key, v: p.value }) });
      case 'kv.del':
        return callApi('/api/mini/kv', { method: 'DELETE', body: Object.assign({}, base, { k: p.key }) });
      case 'message.send':
        return callApi('/api/mini/message', {
          method: 'POST',
          body: Object.assign({}, base, { content: p.text, md: p.md ? 1 : 0, gid: p.gid, pm: p.pm })
        });
      case 'chat.get':
        return callApi('/api/mini/chat' + qs(Object.assign({}, base, { gid: p.gid, pm: p.pm, limit: p.limit })));
      case 'profile.get':
        return callApi('/api/profile' + qs({ name: ctx.username }));
      default:
        return Promise.reject(new Error('unsupported: ' + method));
    }
  }

  /** 握手：等宿主下发上下文（appId / userId / chatId / 已授权权限）与令牌 */
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise(function (resolve) {
      var timer = setTimeout(function () {
        // 宿主没响应时也要让小程序跑起来（离线可用的静态页面不该白屏）
        resolve(null);
      }, 4000);
      handlers.__ready = [
        function (payload) {
          clearTimeout(timer);
          delete handlers.__ready;
          resolve(payload);
        }
      ];
      post({ type: 'hello' });
    });
    return readyPromise;
  }

  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || d.__cc !== PROTO) return;
    var m = d.payload || {};
    if (m.type === 'context') {
      ctx = m.context || null;
      token = m.token || '';
      expires = m.expires || 0;
      if (m.apiBase) apiBase = m.apiBase;
      if (handlers.__ready) {
        var l = handlers.__ready;
        delete handlers.__ready;
        for (var i = 0; i < l.length; i++) l[i](ctx);
      }
      emit('context', ctx);
      return;
    }
    if (m.type === 'rpc.result') {
      var w = waiters[m.id];
      if (!w) return;
      delete waiters[m.id];
      if (m.ok) w.resolve(m.data);
      else w.reject(new Error(m.error || 'rpc failed'));
      return;
    }
    if (m.type === 'invoke') {
      emit('invoke', { command: m.command || '', args: m.args || '', chatId: m.chatId || '' });
      return;
    }
    if (m.type === 'close') {
      emit('close', null);
    }
  });

  var api = {
    /** 等待握手完成，返回上下文（超时返回 null） */
    ready: ready,
    get context() { return ctx; },
    get token() { return token; },
    get expires() { return expires; },

    /** 向当前会话发一条文本消息（需 message.send 权限） */
    sendMessage: function (text, opts) {
      var o = opts || {};
      return request('message.send', { text: String(text || ''), md: !!o.md, gid: o.gid, pm: o.pm });
    },

    /** 读取当前会话信息、成员与最近消息（需 chat.read 权限） */
    getChat: function (opts) {
      var o = opts || {};
      return request('chat.get', { gid: o.gid, pm: o.pm, limit: o.limit || 50 });
    },

    /** 读取调用者自己的资料（需 profile.read 权限） */
    getProfile: function () {
      return request('profile.get', {});
    },

    kv: {
      /** 取值；不存在返回 null */
      get: function (k) {
        return request('kv.get', { key: k }).then(function (j) {
          return j && j.value != null ? j.value : null;
        });
      },
      /** 列出全部键值（需 kv.read 权限） */
      list: function () {
        return request('kv.list', {}).then(function (j) {
          return (j && j.items) || [];
        });
      },
      /** 写入（需 kv.write 权限）；值建议传字符串 */
      set: function (k, v) {
        return request('kv.set', { key: k, value: typeof v === 'string' ? v : JSON.stringify(v) });
      },
      /** 删除（需 kv.write 权限） */
      del: function (k) {
        return request('kv.del', { key: k });
      }
    },

    /** 通用调用：SDK 未封装的能力走这里（同名 method 由宿主实现） */
    request: request,

    /** 关闭自己（宿主会把 iframe 卸掉） */
    close: function () {
      post({ type: 'close' });
    },

    on: function (name, cb) {
      if (!handlers[name]) handlers[name] = [];
      handlers[name].push(cb);
    },
    off: function (name, cb) {
      if (!handlers[name]) return;
      handlers[name] = handlers[name].filter(function (f) { return f !== cb; });
    }
  };

  window.CircleChat = api;
  // 握手可以在页面脚本执行前就完成，先把 hello 发出去避免漏掉
  post({ type: 'hello' });
})();
