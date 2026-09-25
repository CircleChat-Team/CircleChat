// defineNitroPlugin 通常由 Nitro 自动导入，但自动导入依赖构建期生成的
// .nitro/types（未提交、编辑器/独立 tsc 下拿不到），因此这里显式导入。
// 路径与 Nitro 自动导入所用的一致（见 nitropack 的 auto-import 预设），
// 保证打包结果与自动导入完全相同。
import { defineNitroPlugin } from 'nitropack/runtime/internal/plugin';
import fs from 'node:fs';
import { run } from '../lib/migrate';
import * as auth from '../lib/auth';
import * as store from '../lib/store';
import * as audit from '../lib/audit';
import { runFileCleanup, purgeUploadTmp, broadcastLogout, FILE_CLEANUP_INTERVAL, UPLOAD_DIR } from '../lib/runtime';

// 启动初始化（与 server.js L1897-1914 一致）：
// migrate -> auth.init -> store.load -> audit.load -> mkdir(uploads) -> 清理定时器
export default defineNitroPlugin(() => {
  run();                      // 校验并自动迁移数据库结构（兼容旧库）
  auth.init(false);
  store.load();
  audit.load();               
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  purgeUploadTmp(); // 清理上次进程被强杀遗留的上传半成品

  // 过期文件清理：启动执行一次，之后定期检查（仅删硬盘文件，消息记录保留）
  runFileCleanup();
  setInterval(runFileCleanup, FILE_CLEANUP_INTERVAL).unref();

  // 会话只存在进程内存里，重启（每次部署都会重启容器）后全部失效。
  // 收到终止信号时先告诉在线客户端「回登录页重新登录」，别让他们对着断掉的连接干等。
  // ⚠️ 容器里 PID 1 是 /run.sh（bash），docker 的 SIGTERM 不一定转发到 node，
  // 所以这只是「能通知就通知」；通知不到时客户端会在重连拿到 401 后自己回登录页。
  let saidBye = false;
  const goodbye = (): void => {
    if (saidBye) return;
    saidBye = true;
    try {
      broadcastLogout('server-restart');
      // 打一行日志：以后翻容器日志就能确认这条「优雅通知」有没有真的走到
      // （容器里 PID 1 是 bash，docker 的 SIGTERM 未必转发到 node；
      //  没有这行说明信号没到，客户端只能靠重连时的 401 自己回登录页）
      console.log('[shutdown] 已通知在线客户端退出登录，准备退出');
    } catch (e) {
    }
    // 留一点时间把帧写出去，再退出（不挡着进程，也不无限等）
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGTERM', goodbye);
  process.on('SIGINT', goodbye);

  console.log('==========================================');
  console.log(' CircleChat 已加载运行时（Nitro 外壳）');
  console.log(' 数据目录: ' + process.cwd() + '/data');
  console.log(' 消息保留: 最近 ' + store.MAX_MESSAGES + ' 条');
  console.log('==========================================');
});

