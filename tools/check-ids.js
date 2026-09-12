'use strict';
/* 临时检查：app.js 引用的 DOM ID 是否都存在于 index.html */
const fs = require('fs');
const js = fs.readFileSync('public/js/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const ids = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
let ok = true;
for (const id of ids) {
  if (!htmlIds.has(id)) { console.log('缺失ID:', id); ok = false; }
}
console.log(ok ? '全部 ' + ids.size + ' 个引用ID均存在于HTML ✔' : '存在缺失ID!');
process.exit(ok ? 0 : 1);
