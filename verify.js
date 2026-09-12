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
  'server.js': '3b6af0de947fe95788d433e069da4ce7',
  'lib/auth.js': '17af170e1caad9a2a16214c7147f7075',
  'lib/store.js': '8d3aa88f3ef562bdd8f0c3db7cf0236e',
  'lib/groups.js': '0b22fdebb87de4085c060a947ae9d86c',
  'lib/audit.js': 'ecbfaa046bbc6cd48791b96ded7b6cad',
  'lib/ws.js': '8eb09d11bc20e592e092b5955b498f1e',
  'lib/log.js': 'cf6a98065b2452eb57b15a6f5db2fd76',
  'lib/migrate.js': 'fe45d8071a4816a5e64f45abeaa7a91b',
  'lib/friends.js': '1b71ab556fe475e2a0fa80a6c02a1cb9',
  'public/index.html': '07ea987fcca27049710284d88491f308',
  'public/css/style.css': 'df1e3d80509d0930f6e59b0faa216ce7',
  'public/login.html': '1af85b9020afb1496845643e54e6c962',
  'public/chat.html': '775409097f40389b303820bbc798567b',
  'public/admin.html': 'fd0a36a11a081ed5d63e8b706b18d476',
  'public/js/config.js': '29e316e77c56cadc01e3850c87a5b7d1',
  'public/js/i18n.js': '88cf88df85af01b528934fa81f9001cc',
  'public/js/lang/zh.js': 'bcb9cfd0b5ee21e18fb5ae1277cddd4f',
  'public/js/lang/en.js': 'a7d6980753f0f227618b4705621ff21f',
  'public/js/login.js': '1071527f5a3d9ac8c4a27f86afb65edf',
  'public/js/chat.js': '6f13ff926aeaa5ebd789ed4f4f38a033',
  'public/js/admin.js': '102b4fba435d99ddc9deeb25173ffeda',
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
