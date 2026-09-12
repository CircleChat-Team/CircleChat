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
  'server.js': '51ffac12133667d23ecfbfd62230c1b1',
  'lib/auth.js': 'beb1a07b30d8cbb303cffbf2bb449c29',
  'lib/store.js': '526c5b07aa1f83c1363b8421395192a9',
  'lib/groups.js': 'ac94c5d27e9a1e2c0bafbfc043229464',
  'lib/audit.js': '4b8bf73ee4dc8eaa4437b6bedf9fd1d3',
  'lib/ws.js': '46545a1e225b690df4351d8bd0106437',
  'lib/log.js': '242e1358ad4a49f01f4dfa77f3c3d968',
  'lib/migrate.js': '3c99c41a4b36301524056e58fe7dee6c',
  'lib/friends.js': '2881b99cbf3bd0b7c583c46e42f0aa87',
  'public/index.html': '2b54a83715cec1b9fb81d9551be69566',
  'public/css/style.css': 'da5c68f099fff86c2c0805470dd04cc2',
  'public/login.html': '8c14438d8524270d2d92a7f47ea28ca8',
  'public/chat.html': '595d88d5dbc5e812229dc18876b7c628',
  'public/admin.html': '842d10d8ace2c0c5c47043188b07b08a',
  'public/js/config.js': 'cc30713437b819590fd0d07a57e2849f',
  'public/js/i18n.js': 'c5d6aca5c3e48c2d286cc31878f7d2dd',
  'public/js/lang/zh.js': '01f7bb545012885268adbdf0bec230b6',
  'public/js/lang/en.js': '306453923857ae324f6a1bad80a9367d',
  'public/js/login.js': '5467f8e0ff235a8a00802404ea190c89',
  'public/js/chat.js': '287c8ce375c0aa0a3ef1a95868d50122',
  'public/js/admin.js': 'cfca87bee8dce758d0d2b38096591c69',
  'tools/adduser.js': '4f41e52c9f404c7dfd1125c7c1985467',
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
