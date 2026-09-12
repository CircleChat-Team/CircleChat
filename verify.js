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
  'server.js': 'd6af79c7f6ddaa88d592479fa449bfaf',
  'lib/auth.js': '17af170e1caad9a2a16214c7147f7075',
  'lib/store.js': 'fb0b9baf8aedc4cd692fa750d5b245f0',
  'lib/groups.js': '0b22fdebb87de4085c060a947ae9d86c',
  'lib/audit.js': 'ecbfaa046bbc6cd48791b96ded7b6cad',
  'lib/ws.js': '8eb09d11bc20e592e092b5955b498f1e',
  'lib/log.js': 'cf6a98065b2452eb57b15a6f5db2fd76',
  'lib/migrate.js': 'b913e5acdda20d6a2315382b7d4a7e16',
  'public/index.html': '07ea987fcca27049710284d88491f308',
  'public/css/style.css': 'ab839a333798337a67c1cb44facaec47',
  'public/login.html': '18c266cb44f8b40afc6601ae9342cdbd',
  'public/chat.html': '3ad412e975fea5c006b71c3344db2d60',
  'public/admin.html': 'a9de808ff59e16551a4a56a87ff39afd',
  'public/js/config.js': '29e316e77c56cadc01e3850c87a5b7d1',
  'public/js/i18n.js': '3859c17dc4d86754086f9039a4175be5',
  'public/js/lang/zh.js': 'ad7ee100f07d5f1afcb1fff373c86267',
  'public/js/lang/en.js': 'fbc00d2ef809ed536ce71daad9dbff82',
  'public/js/login.js': 'acd2c1527e5e54c29ebf2f68fb7d3a9c',
  'public/js/chat.js': '850d3511ab9f40bff9c47fe86bcb5957',
  'public/js/admin.js': '8725fe3598e7bd11a621538d3f480771',
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
