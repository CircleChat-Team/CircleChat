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
  'server.js': '2aaeec592db2f28bbee1ffdbccdcb0a5',
  'lib/auth.js': 'fdd38af5eb243f31e5236fa77cb69277',
  'lib/store.js': '158d9d878d241583f250e727e3ebbc5b',
  'lib/audit.js': 'ecbfaa046bbc6cd48791b96ded7b6cad',
  'lib/ws.js': '8eb09d11bc20e592e092b5955b498f1e',
  'lib/log.js': 'cf6a98065b2452eb57b15a6f5db2fd76',
  'public/index.html': '07ea987fcca27049710284d88491f308',
  'public/css/style.css': '602611d16b35f99d181304a98e29d42b',
  'public/login.html': 'c4d568859aadf229e4fbb894abf25e55',
  'public/chat.html': '6b05cd59d85228b219117f0e87d99c8c',
  'public/admin.html': 'ecd367c0ef41e48858d6e7dd481ed774',
  'public/js/config.js': '29e316e77c56cadc01e3850c87a5b7d1',
  'public/js/login.js': '6d114faaf6462e9691a5a9374e6d3d3c',
  'public/js/chat.js': '4c05cb99fb7e3988add5b919484dca3f',
  'public/js/admin.js': '67e38ccf688d514fe6293414e07fb7de',
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
