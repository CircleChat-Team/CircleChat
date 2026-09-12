'use strict';
/* ============================================================
 * ChatPlus 私人聊天 — 完整性校验工具
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * 功能：
 *   1. 校验每个源文件 MD5 是否与内置清单一致（防恶意篡改、
 *      防删除版权信息后照常运行）；
 *   2. 校验每个源文件是否包含版权声明（© 2026 Ctoy）。
 * 用法：node verify.js
 * 提示：若部署时按部署文档合法修改了 public/js/config.js 或
 *       tools/adduser.js，请运行 verify.js 并手动更新本清单。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;

// MD5 完整性清单（与各源文件内容一一对应）
const MANIFEST = {
  'server.js': '6081bb22f51a3b981aa50ffde03d6abf',
  'lib/auth.js': 'fdd38af5eb243f31e5236fa77cb69277',
  'lib/store.js': 'e78da6514d3754d09c010e6c4d9c05d7',
  'lib/audit.js': 'ecbfaa046bbc6cd48791b96ded7b6cad',
  'lib/ws.js': '8eb09d11bc20e592e092b5955b498f1e',
  'lib/log.js': 'cf6a98065b2452eb57b15a6f5db2fd76',
  'public/index.html': '07ea987fcca27049710284d88491f308',
  'public/css/style.css': 'a2fd3054c38b18ecdf9af3e4d94865fa',
  'public/login.html': 'c4d568859aadf229e4fbb894abf25e55',
  'public/chat.html': 'e880178a94e8654dde0924403d1f778f',
  'public/admin.html': '99878b9e33ca2e45cfba2d93b4ccfb0c',
  'public/js/config.js': '29e316e77c56cadc01e3850c87a5b7d1',
  'public/js/login.js': '6d114faaf6462e9691a5a9374e6d3d3c',
  'public/js/ui.js': '7971ac118c836f744363ff2f4b7523d6',
  'public/js/chat.js': '7e72a90c5190b89c89b01bc0e7a70af6',
  'public/js/admin.js': '71a15ee36e525a4079d36bd21dc1f90d',
  'tools/adduser.js': '6fcfc3d222d97ef6d2b095f4f24ccd92'
};

const COPYRIGHT_MARK = '© 2026 Ctoy';

function md5Of(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex');
}

let allOk = true;

console.log('ChatPlus 完整性校验（MD5 + 版权声明）\n');

for (const rel of Object.keys(MANIFEST)) {
  const abs = path.join(ROOT, rel);
  const actual = md5Of(rel);
  const expected = MANIFEST[rel];
  const hasCopyright = (() => {
    try {
      return fs.readFileSync(abs, 'utf8').includes(COPYRIGHT_MARK);
    } catch (e) { return false; }
  })();

  const md5Ok = actual === expected;
  const copyOk = hasCopyright;
  const mark = md5Ok && copyOk ? '✔ 通过' : '✘ 异常';
  if (!md5Ok || !copyOk) allOk = false;
  console.log(
    (md5Ok ? '  [MD5 一致]' : '  [MD5 不一致]') +
    (copyOk ? '[版权存在]' : '[版权缺失]') +
    '  ' + rel
  );
  if (!md5Ok) {
    console.log('      期望 ' + expected + '，实际 ' + actual + '。文件被改动，请核对来源！');
  }
}

console.log('');
if (allOk) {
  console.log('结果：全部通过 ✔ 文件完整，版权信息完好。');
} else {
  console.log('结果：存在异常 ✘ 请立即检查上述文件是否被篡改！');
}
process.exit(allOk ? 0 : 1);
