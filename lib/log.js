'use strict';
/* ============================================================
 * ChatPlus 私人聊天服务器 — 访问日志模块
 * 记录所有 HTTP 请求与 WebSocket 连接（应用层网络监控）。
 * ============================================================ */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'data');
const LOG_FILE = path.join(LOG_DIR, 'access.log');

// 确保日志目录存在
function ensureDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* 忽略 */ }
}

/**
 * 写入一条访问日志（异步，不阻塞主流程）
 * @param {Object} entry  {ts, ip, method, url, status, ms, ua, proto}
 */
function write(entry) {
  const line = JSON.stringify({
    ts: entry.ts || new Date().toISOString(),
    ip: entry.ip || '-',
    proto: entry.proto || 'http',
    method: entry.method || '-',
    url: entry.url || '-',
    status: entry.status || 0,
    ms: entry.ms || 0,
    ua: entry.ua || '-'
  }) + '\n';
  // 控制台同步输出，方便服务器直接查看
  console.log(`[${line.slice(0, line.length - 1)}]`);
  try {
    ensureDir();
    fs.appendFile(LOG_FILE, line, (err) => { if (err) console.error('[log] 写入失败:', err.message); });
  } catch (e) { console.error('[log] 写入异常:', e.message); }
}

module.exports = { write, LOG_FILE };
