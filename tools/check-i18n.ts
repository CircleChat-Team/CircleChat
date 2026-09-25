/* ============================================================
 * 三语文案自检（跑法：npm run check:i18n）
 *
 * 查三类问题：
 * 1. **标量被自己的子键挤掉**：文案是扁平点号字典，运行时 nest() 成嵌套对象，
 *    所以 `a.b` 与 `a.b.c` 同时存在时，`a.b` 会变成对象，界面直接显示键名。
 *    踩过两次：common.lastSeen、login.captcha。
 *    例外：`*.one` / `*.other` 是复数键（pluralCategory 动态拼），它们把父级标量
 *    「挤掉」是无害的（父级标量本来就没人用），只提示不算错。
 * 2. **三语键没对齐**：zh 为基准，en/ja 缺键或多键都要报出来。
 * 3. **源码里引用的键必须真的存在**：`tr('login.username')` 这种写错的键，
 *    tr 找不到就原样返回键名，界面上会直接显示键名（踩过）。
 *    动态拼的（`tr('mod.type.' + t)`）只校验「这个前缀下至少有键」。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
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

// ---------- 源码里引用的键必须存在 ----------

const KEY_FUNCS = ['tr', 'trn', 'auditDetail', 'notify', 'toast'];
const SRC_DIRS = ['src', path.join('server', 'lib')];
const SKIP_DIRS = ['public', 'node_modules', 'dist', '.output'];

function walk(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (SKIP_DIRS.indexOf(name) !== -1) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|vue)$/.test(name)) out.push(full);
  }
}

const sources: string[] = [];
for (const d of SRC_DIRS) if (fs.existsSync(d)) walk(d, sources);

const missingKeys: string[] = [];
const missingPrefix: string[] = [];
const allKeys = Object.keys(files.zh);
// 第 3 组：后面跟 `+` 的就是动态拼接（tr('mod.type.' + t)）
const callRe = new RegExp('\\b(?:' + KEY_FUNCS.join('|') + ')\\(\\s*([\'"])([^\'"]+)\\1(\\s*\\+)?', 'g');

for (const f of sources) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const t = raw.trim();
    // 注释里写的键不算引用（文档里常写用法示例）
    if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return;
    const line = raw.replace(/\/\/.*$/, ''); 
    for (const m of line.matchAll(callRe)) {
      const key = m[2];
      // 带空格或中日文 → 那已经是文案而不是键，交给运行时的 warn
      if (/[\s\u3000-\u9fff\uff00-\uffef]/.test(key)) continue;
      if (m[3]) {
        if (!allKeys.some((k) => k.startsWith(key))) missingPrefix.push(`${f}:${i + 1}  「${key}」前缀下没有任何键`);
        continue;
      }
      if (!files.zh[key]) missingKeys.push(`${f}:${i + 1}  ${key}`);
    }
  });
}

console.log(`\n[引用检查] 扫描 ${sources.length} 个文件`);
if (missingKeys.length) {
  bad += missingKeys.length;
  console.log(`❌ 引用了不存在的键 ${missingKeys.length} 处（界面会直接显示键名）：`);
  missingKeys.slice(0, 20).forEach((x) => console.log('   ' + x));
} else {
  console.log('✅ 源码里引用的键都存在');
}
if (missingPrefix.length) {
  bad += missingPrefix.length;
  console.log(`❌ 动态前缀无效 ${missingPrefix.length} 处：`);
  missingPrefix.slice(0, 10).forEach((x) => console.log('   ' + x));
} else {
  console.log('✅ 动态前缀都能匹配到键');
}

console.log(bad === 0 ? '\n✅ 文案自检通过' : `\n真问题 ${bad} 处`);
process.exit(bad === 0 ? 0 : 1);
