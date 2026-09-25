/* 自检：ACTION_GROUPS 必须与 ACTION_KEYS 完全对齐（漏一个动作就永远筛不出来） */
import { ACTION_KEYS, ACTION_GROUPS, formatAuditDetail } from '../src/core/auditActions.ts';

const all = Object.keys(ACTION_KEYS);
const seen = new Map<string, string[]>();
for (const g of ACTION_GROUPS) {
  for (const a of g.actions) {
    if (!seen.has(a)) seen.set(a, []);
    seen.get(a)!.push(g.key);
  }
}

let bad = 0;
const dup = [...seen.entries()].filter(([, gs]) => gs.length > 1);
if (dup.length) {
  bad += dup.length;
  console.log('❌ 一个动作落在多个组：');
  dup.forEach(([a, gs]) => console.log(`   ${a} → ${gs.join(', ')}`));
}

const missing = all.filter((a) => !seen.has(a));
if (missing.length) {
  bad += missing.length;
  console.log('❌ 有动作没被分到任何组（将无法筛选）：');
  missing.forEach((a) => console.log('   ' + a));
}

const ghost = [...seen.keys()].filter((a) => !ACTION_KEYS[a]);
if (ghost.length) {
  bad += ghost.length;
  console.log('❌ 组里出现了 ACTION_KEYS 之外的动作：');
  ghost.forEach((a) => console.log('   ' + a));
}

console.log(`动作 ${all.length} 个，分组 ${ACTION_GROUPS.length} 个，覆盖 ${seen.size} 个`);
ACTION_GROUPS.forEach((g) => console.log(`   ${g.key.padEnd(9)} ${String(g.actions.length).padStart(2)} 项`));

// 旧版写死中文的详情不该被 JSON 解析影响（顺手验证格式化没坏）
const t = (k: string): string => k;
if (formatAuditDetail('旧版详情', t) !== '旧版详情') { bad++; console.log('❌ 旧版详情格式化异常'); }
if (formatAuditDetail('{"k":"a.b","v":{"n":1}}', () => 'OK') !== 'OK') { bad++; console.log('❌ 新格式详情格式化异常'); }

console.log(bad === 0 ? '✅ 分组与动作表完全对齐' : `真问题 ${bad} 处`);
process.exit(bad === 0 ? 0 : 1);
