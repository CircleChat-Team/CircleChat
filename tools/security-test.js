'use strict';
/* 临时安全测试脚本（一次性） */
const http = require('http');
const crypto = require('crypto');

const HOST = '127.0.0.1';
const PORT = 8088;

function request(opts, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: HOST, port: PORT, ...opts }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    req.on('error', () => resolve({ status: 0, body: '', headers: {} }));
    if (body) req.write(body);
    req.end();
  });
}

function wsFrame(payload, mask) {
  const data = Buffer.from(payload, 'utf8');
  const len = data.length;
  const header = [0x81];
  if (mask) header.push(0x80 | len);
  else header.push(len);
  let frame = Buffer.from(header);
  if (mask) {
    const key = crypto.randomBytes(4);
    const masked = Buffer.from(data);
    for (let i = 0; i < len; i++) masked[i] ^= key[i & 3];
    frame = Buffer.concat([frame, key, masked]);
  } else {
    frame = Buffer.concat([frame, data]);
  }
  return frame;
}

function wsConnect(cookie) {
  return new Promise((resolve) => {
    const req = http.request({
      host: HOST, port: PORT, path: '/ws',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13', Cookie: cookie }
    });
    req.on('upgrade', (res, socket) => resolve({ socket, status: res.statusCode }));
    req.on('response', (res) => { res.resume(); resolve({ socket: null, status: res.statusCode }); });
    req.on('error', () => resolve({ socket: null, status: 0 }));
    req.end();
  });
}

(async () => {
  console.log('=== CircleChat 安全实测 ===');

  // 1. 编码路径穿越
  let r = await request({ path: '/%2e%2e%2f%2e%2e%2fWindows%2fwin.ini', method: 'GET' });
  console.log('1. 编码路径穿越  -> ' + r.status + (r.status === 403 || r.status === 404 ? ' ✔ 已拦截' : ' ✘ 异常!'));

  // 2. 登录拿会话
  r = await request({ path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ username: 'Ctoy', password: 'Yhc061900' }));
  const cookie = (r.headers['set-cookie'] || [''])[0].split(';')[0];
  console.log('2. 登录 -> ' + r.status + (cookie ? ' ✔ 已获会话' : ' ✘'));

  // 3. WS 伪造 file 消息注入 javascript: URL
  const ws1 = await wsConnect(cookie);
  if (ws1.socket) {
    await new Promise((res) => setTimeout(res, 200));
    ws1.socket.write(wsFrame(JSON.stringify({ type: 'msg', data: { type: 'file', content: 'javascript:alert(1)', name: 'x' } }), true));
    await new Promise((res) => setTimeout(res, 300));
    // 拉取消息确认没有被存储
    const chk = await request({ path: '/api/messages', method: 'GET', headers: { Cookie: cookie } });
    const list = JSON.parse(chk.body).messages;
    const injected = list.some((m) => m.content && String(m.content).startsWith('javascript'));
    console.log('3. WS伪造javascript注入 -> ' + (injected ? '✘ 注入成功!!' : '✔ 已拒绝，未存储'));
    ws1.socket.destroy();
  } else {
    console.log('3. WS伪造javascript注入 -> 连接失败 status=' + ws1.status);
  }

  // 4. WS 未掩码帧（违反 RFC6455）——服务器应发 Close 帧(0x88)并关闭
  const ws2 = await wsConnect(cookie);
  if (ws2.socket) {
    await new Promise((res) => setTimeout(res, 200));
    const recv = [];
    ws2.socket.on('data', (c) => recv.push(c));
    ws2.socket.write(wsFrame(JSON.stringify({ type: 'ping' }), false));
    await new Promise((res) => setTimeout(res, 1500));
    const all = Buffer.concat(recv);
    console.log('    [debug] 未掩码帧测试收到 ' + all.length + ' 字节: ' + all.toString('hex'));
    // 服务器广播 presence 帧后应紧接发 Close 帧（首字节 0x88）
    const gotClose = all.indexOf(0x88) !== -1;
    console.log('4. 未掩码帧 -> ' + (gotClose ? '✔ 收到Close帧，连接已拒绝' : '✘ 未收到Close帧!'));
    ws2.socket.destroy();
  } else {
    console.log('4. 未掩码帧 -> 连接失败 status=' + ws2.status);
  }

  // 5. 未登录访问受保护接口
  r = await request({ path: '/api/messages', method: 'GET' });
  console.log('5. 未登录访问 /api/messages -> ' + r.status + (r.status === 401 ? ' ✔ 已拦截' : ' ✘'));

  // 6. 错误密码登录
  r = await request({ path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ username: 'Ctoy', password: 'bad' }));
  console.log('6. 错误密码 -> ' + r.status + (r.status === 401 ? ' ✔ 已拒绝' : ' ✘'));

  process.exit(0);
})();
