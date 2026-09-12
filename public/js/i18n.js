/* ============================================================
 * ChatPlus 私人聊天 — 国际化运行时
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 *
 * 加载顺序（必须在 lang/*.js 之前）：
 *   /js/i18n.js  →  /js/lang/zh.js  →  /js/lang/en.js  →  页面脚本
 *
 * 用法：
 *   I18N.t('login.submit')                  取文案
 *   I18N.t('login.footer', { url: '...' })  占位符替换
 *   I18N.tn('chat.count', 3)                复数（字典写 key.one / key.other）
 *   I18N.apply()                            应用 DOM 上的 data-i18n 系列属性
 *   I18N.set('en')                          切换语言（会触发 onChange）
 *   I18N.onChange(fn)                       注册切换后的回调
 *
 * HTML 侧支持四种属性：
 *   data-i18n              → textContent
 *   data-i18n-title        → title
 *   data-i18n-placeholder  → placeholder
 *   data-i18n-aria         → aria-label
 * ============================================================ */

window.I18N = (function () {
  'use strict';

  var STORAGE_KEY = 'chatplus_lang';
  var FALLBACK = 'zh';
  var SUPPORTED = ['zh', 'en'];

  // 语言自称（切换按钮上显示，不参与翻译）
  var NATIVE_NAME = { zh: '中文', en: 'EN' };

  // 由 lang/zh.js、lang/en.js 挂载
  var dict = {};

  function normalize(code) {
    var c = String(code || '').toLowerCase();
    if (c.indexOf('zh') === 0) return 'zh';
    if (c.indexOf('en') === 0) return 'en';
    return '';
  }

  function detect() {
    var saved = null;
    // localStorage 在隐私模式下可能抛异常
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { saved = null; }
    var n = normalize(saved);
    if (n) return n;

    var list = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < list.length; i++) {
      var m = normalize(list[i]);
      if (m) return m;
    }
    return FALLBACK;
  }

  var current = detect();

  function lookup(lang, key) {
    var d = dict[lang];
    if (!d) return null;
    var v = d[key];
    return v == null ? null : v;
  }

  function interpolate(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
    });
  }

  /**
   * 取文案。回退链：当前语言 → zh → key 本身。
   * 两边都缺时直接把 key 显示出来，方便一眼看出漏翻，而不是静默显示空白。
   */
  function t(key, vars) {
    var s = lookup(current, key);
    if (s === null) s = lookup(FALLBACK, key);
    if (s === null) return key;
    return vars ? interpolate(s, vars) : s;
  }

  function pluralForm(n) {
    try {
      if (window.Intl && window.Intl.PluralRules) {
        return new window.Intl.PluralRules(current).select(n);
      }
    } catch (e) { /* 老浏览器退回英文规则 */ }
    return n === 1 ? 'one' : 'other';
  }

  /** 带复数的取文案：优先 key.<one|other>，再退到 key 本身 */
  function tn(key, n, vars) {
    var s = lookup(current, key + '.' + pluralForm(n));
    if (s === null) s = lookup(current, key + '.other');
    if (s === null) s = lookup(FALLBACK, key + '.other');
    if (s === null) s = lookup(FALLBACK, key);
    if (s === null) return key;

    var v = { n: n };
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) v[k] = vars[k];
      }
    }
    return interpolate(s, v);
  }

  // 属性名 → 目标属性；值为 null 表示写入 textContent
  var ATTRS = [
    ['data-i18n', null],
    ['data-i18n-title', 'title'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria', 'aria-label']
  ];

  /** 把 DOM 上所有 data-i18n* 节点重新刷一遍，并同步 <html lang> */
  function apply(scope) {
    var root = scope || document;
    for (var a = 0; a < ATTRS.length; a++) {
      var attr = ATTRS[a][0];
      var prop = ATTRS[a][1];
      var nodes = root.querySelectorAll('[' + attr + ']');
      for (var i = 0; i < nodes.length; i++) {
        var key = nodes[i].getAttribute(attr);
        if (!key) continue;
        var text = t(key);
        if (prop) nodes[i].setAttribute(prop, text);
        else nodes[i].textContent = text;
      }
    }
    document.documentElement.lang = current === 'zh' ? 'zh-CN' : current;
  }

  var listeners = [];

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function set(lang) {
    var n = normalize(lang) || FALLBACK;
    if (n === current) return;
    current = n;
    try { localStorage.setItem(STORAGE_KEY, n); } catch (e) { /* 忽略 */ }
    for (var i = 0; i < listeners.length; i++) listeners[i](n);
  }

  /** 下一个语言：目前只有两种，用作切换按钮的目标 */
  function next() {
    var i = SUPPORTED.indexOf(current);
    return SUPPORTED[(i + 1) % SUPPORTED.length];
  }

  return {
    dict: dict,                                   // 供 lang/*.js 挂载
    t: t,
    tn: tn,
    apply: apply,
    set: set,
    onChange: onChange,
    next: next,
    current: function () { return current; },
    langName: function (code) { return NATIVE_NAME[normalize(code)] || String(code || ''); },
    supported: SUPPORTED
  };
})();
