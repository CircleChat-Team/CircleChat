import fs from 'node:fs';
import { run } from '../lib/migrate';
import * as auth from '../lib/auth';
import * as store from '../lib/store';
import * as audit from '../lib/audit';
import { runFileCleanup, purgeUploadTmp, FILE_CLEANUP_INTERVAL, UPLOAD_DIR } from '../lib/runtime';

// 启动初始化（与 server.js L1897-1914 一致）：
// migrate -> auth.init -> store.load -> audit.load -> mkdir(uploads) -> 清理定时器
export default defineNitroPlugin(() => {
  run();                      // 校验并自动迁移数据库结构（兼容旧库）
  auth.init(false);
  store.load();
  audit.load();               // 初始化审计日志表
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  purgeUploadTmp(); // 清理上次进程被强杀遗留的上传半成品

  // 过期文件清理：启动执行一次，之后定期检查（仅删硬盘文件，消息记录保留）
  runFileCleanup();
  setInterval(runFileCleanup, FILE_CLEANUP_INTERVAL).unref();

  console.log('==========================================');
  console.log(' CircleChat 已加载运行时（Nitro 外壳）');
  console.log(' 数据目录: ' + process.cwd() + '/data');
  console.log(' 消息保留: 最近 ' + store.MAX_MESSAGES + ' 条');
  console.log('==========================================');
});

