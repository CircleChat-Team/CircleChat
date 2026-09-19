/* ============================================================
 * CircleChat 私人聊天 — 用户管理工具（添加 / 修改密码）（Nitro 版，对应 tools/adduser.js）
 * 用法：
 *   node --experimental-strip-types tools/adduser.ts <用户名> [新密码]
 *   若省略新密码，将提示交互输入（不回显）。
 * 路径锚定 process.cwd()（启动目录 = 项目根），与 server/lib/*.ts 一致。
 * ============================================================ */

import readline from 'node:readline';
import * as auth from '../server/lib/auth.ts';

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.stdin;
    const onData = (buf: Buffer) => {
      const s = buf.toString();
      if (s.includes('\r') || s.includes('\n')) {
        // 回退一行，隐藏输入
        process.stdout.write('\r' + ' '.repeat(question.length + 32) + '\r');
        cleanup();
        resolve(s.trim());
      }
    };
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      rl.close();
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const username = (args[0] || '').trim();
  if (!username) {
    console.log('用法: node --experimental-strip-types tools/adduser.ts <用户名> [新密码]');
    process.exit(1);
  }
  if (!/^[\w\u4e00-\u9fa5\-\.]{2,32}$/.test(username)) {
    console.log('用户名仅支持字母/数字/下划线/中文/点/横线，长度 2-32');
    process.exit(1);
  }
  let password = args[1] || '';
  if (!password) {
    password = await promptHidden('请输入新密码（输入不回显）: ');
  }
  if (password.length < 8 || !/[0-9]/.test(password) || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    console.log('密码需至少 8 位，且同时包含数字、大小写字母和特殊符号');
    process.exit(1);
  }

  auth.init(false);
  const existed = !!(auth.loadUsers() || {})[username];
  if (auth.setPassword(username, password)) {
    console.log((existed ? '已修改密码: ' : '已创建账号: ') + username);
  } else {
    console.log('操作失败');
    process.exit(1);
  }
  process.exit(0);
}

main();
