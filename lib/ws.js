'use strict';
/* ============================================================
 * ChatPlus 私人聊天服务器 — WebSocket 协议实现（RFC 6455）
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * [WM: 本模块为关键通信模块，请勿改动，改动将导致完整性校验失败]
 * 自研实现，零第三方依赖：支持握手、帧编解码、
 * 粘包处理、分片重组、掩码解码、Ping/Pong、Close。
 * ============================================================ */

const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xA };
const MAX_FRAME = 2 * 1024 * 1024; // 单条消息上限 2MB（防滥用）

/* ---------- 服务端握手 ---------- */
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) return false;
  const acceptKey = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey + '\r\n' +
    '\r\n'
  );
  return true;
}

/* ---------- 帧编码（服务端 → 客户端，不掩码） ---------- */
function encode(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

const encodeText = (s) => encode(OP.TEXT, s);
const encodePing = () => encode(OP.PING, Buffer.alloc(0));
const encodeClose = (code) => {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(code || 1000, 0);
  return encode(OP.CLOSE, buf);
};

/* ---------- 帧解码器 ----------
 * handlers: { onText, onPing, onClose(codeBuf, reason) }
 * 处理：粘包缓冲、长度扩展、掩码、分片重组。 */
class Decoder {
  constructor(handlers) {
    this.onText = handlers.onText || null;
    this.onPing = handlers.onPing || null;
    this.onClose = handlers.onClose || null;
    this.buf = Buffer.alloc(0);
    this.fragOp = -1;
    this.fragData = null;
    this.destroyed = false;
  }

  push(chunk) {
    if (this.destroyed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      // 防跨协议注入：客户端帧必须掩码（RFC 6455 §5.1）
      if (!masked) return this.fail('client frame not masked');
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) return this.fail('frame too large');
        len = Number(big);
        off = 10;
      }
      if (len > MAX_FRAME) return this.fail('frame too large');
      let maskKey = null;
      if (masked) {
        if (this.buf.length < off + 4) return;
        maskKey = this.buf.slice(off, off + 4);
        off += 4;
      }
      if (this.buf.length < off + len) return;
      let payload = this.buf.slice(off, off + len);
      if (masked) {
        payload = Buffer.from(payload);
        for (let i = 0; i < len; i++) payload[i] ^= maskKey[i & 3];
      }
      this.buf = this.buf.slice(off + len);
      this.handleFrame(fin, opcode, payload);
      if (this.destroyed) return;
    }
  }

  handleFrame(fin, opcode, payload) {
    switch (opcode) {
      case OP.CLOSE:
        this.destroyed = true;
        if (this.onClose) this.onClose(payload);
        return;
      case OP.PING:
        if (this.onPing) this.onPing();
        return;
      case OP.PONG:
        return;
      case OP.CONT:
        if (this.fragOp < 0) return this.fail('unexpected continuation frame');
        this.fragData = this.fragData ? Buffer.concat([this.fragData, payload]) : payload;
        if (this.fragData.length > MAX_FRAME) return this.fail('frame too large');
        if (fin) {
          const op = this.fragOp;
          const data = this.fragData;
          this.fragOp = -1;
          this.fragData = null;
          this.dispatch(op, data);
        }
        return;
      case OP.TEXT:
      case OP.BINARY:
        if (this.fragOp >= 0) return this.fail('new data frame during fragmentation');
        if (fin) { this.dispatch(opcode, payload); return; }
        this.fragOp = opcode;
        this.fragData = payload;
        return;
      default:
        return this.fail('unknown opcode ' + opcode);
    }
  }

  dispatch(opcode, data) {
    if (opcode === OP.TEXT && this.onText) this.onText(data.toString('utf8'));
  }

  fail(reason) {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.onClose) this.onClose(null, reason);
  }
}

module.exports = { accept, encodeText, encodePing, encodeClose, Decoder, MAX_FRAME };
