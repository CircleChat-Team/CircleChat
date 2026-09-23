/* ============================================================
 * 图形验证码（登录 / 注册用）
 *
 * svg-captcha 生成 SVG，**答案只留在服务端内存**，前端拿到的只是一个随机 id：
 *   GET /api/captcha  → { id, svg }
 *   提交登录/注册时带上 { captchaId, captcha }
 *
 * 几个刻意的取舍：
 *  - 存内存不落库：重启后全部失效（重新取一张就好），不留垃圾数据，
 *    也不给「猜中以后翻库复用」留机会；
 *  - **一次性**：无论对错，校验过就删掉，同一个 id 不能复用；
 *  - 老/缺 id 一律按「已过期」处理（前端漏传时也不会被绕过）；
 *  - 有上限 + 过期清理，避免被脚本狂刷把内存吃满。
 * ============================================================ */
import crypto from 'node:crypto';
import svgCaptcha from 'svg-captcha';
import { get as cfgGet, set as cfgSet } from './appconfig';

/** 开关存在 app_config（整站级，管理员在管理面板改） */
const CFG = { login: 'captcha.login', register: 'captcha.register' } as const;

/** 需要人机验证的页面 */
export type CaptchaScope = 'login' | 'register';

/**
 * 某页面是否开启人机验证。
 * **只有明确存成 '0' 才算关**：这样老部署（没有这个配置项）升级后仍然是开启的，
 * 不会因为加了个开关就把验证悄悄关掉。
 */
export function isEnabled(scope: CaptchaScope): boolean {
  return cfgGet(CFG[scope]) !== '0';
}

export function setEnabled(scope: CaptchaScope, on: boolean): void {
  cfgSet(CFG[scope], on ? '1' : '0');
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 2000;

const store = new Map<string, { text: string; expires: number }>();

function purge(now: number): void {
  for (const [k, v] of store) {
    if (v.expires <= now) store.delete(k);
  }
  // 清完过期还超上限，就按插入顺序丢最旧的（Map 保证插入顺序）
  while (store.size > MAX_ENTRIES) {
    const first = store.keys().next();
    if (first.done) break;
    store.delete(first.value);
  }
}

/** 生成一张验证码：返回随机 id 与 SVG 字符串（不含答案） */
export function create(dark = false): { id: string; svg: string } {
  const now = Date.now();
  purge(now);
  const c = svgCaptcha.create({
    size: 4,
    noise: 2,
    ignoreChars: '0o1ilI', // 去掉长得像的字符，省得用户白白输错
    // color 只接受布尔值：true=随机彩色（浅色主题下够清楚）。
    // 深色主题不能用随机色（随机到深色就在深底上看不见了），
    // 库自带的 inverse 就是为这个场景准备的：color=false 时用浅灰绘制。
    color: !dark,
    inverse: dark,
    background: dark ? '#2c2c2e' : '#f0f0f4',
    width: 132,
    height: 44,
    fontSize: 44
  });
  const id = crypto.randomBytes(16).toString('hex');
  store.set(id, { text: String(c.text || '').toLowerCase(), expires: now + TTL_MS });
  return { id, svg: String(c.data || '') };
}

export type VerifyResult = 'ok' | 'wrong' | 'expired';

/** 校验一次验证码（成功/失败都会消费掉它） */
export function verify(id: string, input: string): VerifyResult {
  const key = String(id || '');
  const hit = key ? store.get(key) : undefined;
  if (!hit) return 'expired';
  store.delete(key);
  if (hit.expires <= Date.now()) return 'expired';
  const ans = String(input || '').trim().toLowerCase();
  if (!ans) return 'wrong';
  return ans === hit.text ? 'ok' : 'wrong';
}
