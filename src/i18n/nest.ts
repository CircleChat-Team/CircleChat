/* ============================================================
 * 扁平 key（'a.b.c'）↔ vue-i18n 需要的嵌套结构
 *
 * ⚠️ 抽成独立模块是为了能单测：这里有个不易察觉的坑——
 * 同一个名字**既当标量又当父节点**时（例如同时有 `x` 和 `x.one`），
 * 标量会被子键挤掉。复数形式（`x.one`/`x.other`，靠 trn 取值）本来就不需要
 * 那个标量，没问题；但如果代码真的会去取 `x` 本身（例如 `common.lastSeen`），
 * 那就必须把两侧名字错开，否则界面上只会显示键名本身。
 * 用 scripts 里的审计脚本检查这类冲突。
 * ============================================================ */

export type Dict = Record<string, string>;

/** 把扁平字典转成嵌套结构（叶子是字符串） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function nest(flat: Dict): any {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(flat)) {
    const parts = key.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      // 若当前节点已是「叶子字符串」，说明它本应是个对象
      // （例如同时定义了 "x" 与 "x.one"/"x.other" 的复数形式），
      // 在此把它升级为空对象，避免后面给字符串挂属性时报错。
      // ⚠️ 注意：这一步会**丢掉那个标量**——代码若还要取 "x" 本身就会拿到键名，
      // 所以那种情况下必须换名字，而不是指望这里兜住。
      if (typeof cur[part] === 'string') cur[part] = {};
      if (typeof cur[part] !== 'object' || cur[part] === null) cur[part] = {};
      cur = cur[part] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1];
    // 若该叶子已被复数子键（如 .one/.other）占用成对象，则不要被标量覆盖。
    if (typeof cur[last] !== 'object') cur[last] = flat[key];
  }
  return out;
}

export interface ScalarPrefixConflict {
  /** 既当标量又当父节点的那把键 */
  parent: string;
  /** 被挤掉的标量取值 */
  scalarValue: string;
  /** 把标量挤掉的子键 */
  children: string[];
  /**
   * 子键是否只有 `*.one` / `*.other`（复数形式）。
   * 这种是**正常写法**：复数走 trn()，只会去取 `.one`/`.other`，不取父键本身，
   * 所以父键那个标量是多余的、被挤掉也无所谓。
   * 为 false 才是真问题——说明代码真的会取父键，界面上会显示键名本身。
   */
  benignPluralOnly: boolean;
}

/**
 * 找出「同名既是标量又是父节点」的键（nest() 会把标量丢掉的那些）。
 * 筛 `benignPluralOnly === false` 的就是会导致界面显示键名的真问题。
 */
export function findScalarPrefixConflicts(flat: Dict): ScalarPrefixConflict[] {
  const keys = Object.keys(flat);
  const out: ScalarPrefixConflict[] = [];
  for (const k of keys) {
    if (typeof flat[k] !== 'string') continue;
    const children = keys.filter((x) => x !== k && x.startsWith(k + '.'));
    if (!children.length) continue;
    out.push({
      parent: k,
      scalarValue: flat[k],
      children,
      benignPluralOnly: children.every((c) => /\.(one|other)$/.test(c))
    });
  }
  return out;
}
