/* ============================================================
 * 三语文案自检（跑法：node --experimental-strip-types tools/check-i18n.ts）
 *
 * 查两类问题：
 * 1. **标量被自己的子键挤掉**：文案是扁平点号字典，运行时 nest() 成嵌套对象，
 *    所以 `a.b` 与 `a.b.c` 同时存在时，`a.b` 会变成对象，界面直接显示键名。
 *    踩过两次：common.lastSeen、login.captcha。
 *    例外：`*.one` / `*.other` 是复数键（pluralCategory 动态拼），它们把父级标量
 *    「挤掉」是无害的（父级标量本来就没人用），只提示不算错。
 * 2. **三语键没对齐**：zh 为基准，en/ja 缺键或多键都要报出来。
 * ============================================================ */
import zh from '../src/i18n/messages/zh.ts';
import en from '../src/i18n/messages/en.ts';
import ja from '../src/i18n/messages/ja.ts';

const files: Record<string, Record<string, string>> = { zh, en, ja };
const PLURAL = /\.(one|other)$/;
let bad = 0;

for (const [lang, dict] of Object.entries(files)) {
  const keys = Object.keys(dict);
  const real: string[] = [];
  const benign: string[] = [];
  for (const k of keys) {
    const children = keys.filter((o) => o !== k && o.startsWith(k + '.'));
    if (!children.length) continue;
    if (children.every((c) => PLURAL.test(c))) benign.push(`${k}  ← ${children.join(', ')}`);
    else real.push(`${k}  ← ${children.join(', ')}`);
  }
  console.log(`[${lang}] ${keys.length} 键：真冲突 ${real.length} 组，复数键冗余 ${benign.length} 组`);
  real.slice(0, 10).forEach((r) => console.log('   ❌ ' + r));
  benign.slice(0, 3).forEach((r) => console.log('   ·  ' + r));
  bad += real.length;
}

const base = Object.keys(files.zh).sort();
for (const [lang, dict] of Object.entries(files)) {
  const missing = base.filter((k) => !dict[k]);
  const extra = Object.keys(dict).filter((k) => !files.zh[k]);
  if (missing.length || extra.length) bad += missing.length + extra.length;
  console.log(`[${lang}] 相对 zh：缺 ${missing.length}，多 ${extra.length}`);
  missing.slice(0, 8).forEach((k) => console.log('   缺 ' + k));
  extra.slice(0, 8).forEach((k) => console.log('   多 ' + k));
}

// 空值也是问题（界面会显示空白）
for (const [lang, dict] of Object.entries(files)) {
  const empty = Object.keys(dict).filter((k) => !String(dict[k]).trim());
  if (empty.length) {
    bad += empty.length;
    console.log(`[${lang}] 空文案 ${empty.length} 条: ${empty.slice(0, 5).join(', ')}`);
  }
}

console.log(bad === 0 ? '✅ 文案自检通过' : `真问题 ${bad} 处`);
process.exit(bad === 0 ? 0 : 1);
