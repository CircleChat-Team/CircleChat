// CircleChat — 访问日志模块（Nitro 版，对应 lib/log.js）
// 记录所有 HTTP 请求与 WebSocket 连接（应用层网络监控），追加到 data/access.log 并同步打印控制台。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// server/lib/log.ts -> ../../data
const LOG_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const LOG_FILE = path.join(LOG_DIR, 'access.log');

// 确保日志目录存在
function ensureDir(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    /* 忽略 */
  }
}

export interface LogEntry {
  ts?: string;
  ip?: string;
  proto?: string;
  method?: string;
  url?: string;
  status?: number;
  ms?: number;
  ua?: string;
}

/**
 * 写入一条访问日志（异步追加，不阻塞主流程）
 */
export function write(entry: LogEntry): void {
  const line =
    JSON.stringify({
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
  console.log(`[${line.slice(0, -1)}]`);

  try {
    ensureDir();
    fs.appendFile(LOG_FILE, line, (err) => {
      if (err) console.error('[log] 写入失败:', err.message);
    });
  } catch (e) {
    console.error('[log] 写入异常:', (e as Error).message);
  }
}

export { LOG_FILE };
