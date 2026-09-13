/* ============================================================
 * CircleChat 私人聊天 — 国际化运行时
 *
 * 加载顺序（必须在 lang/*.js 之前）：
 *   /js/i18n.js  →  /js/lang/zh.js  →  /js/lang/en.js  →  /js/lang/jp.js  →  页面脚本
 *
 * 用法：
 *   I18N.t('login.submit')                  取文案
 *   I18N.t('login.footer', { url: '...' })  占位符替换
 *   I18N.tn('chat.count', 3)                复数（字典写 key.one / key.other）
 *   I18N.apply()                            应用 DOM 上的 data-i18n 系列属性
 *   I18N.set('en')                          切换语言（会触发 onChange）
 *   I18N.languages()                        已加载的语言列表，供下拉框渲染
 *   I18N.onChange(fn)                       注册切换后的回调
 *
 * 新增一种语言：写一个 lang/xx.js（含 'lang.name': 该语言自称），
 * 在页面加一行 <script>，下拉框会自动出现该选项。
 * 想调整下拉框里的排序，把语言码加进下方 SUPPORTED 即可。
 *
 * HTML 侧支持四种属性：
 *   data-i18n              → textContent
 *   data-i18n-title        → title
 *   data-i18n-placeholder  → placeholder
 *   data-i18n-aria         → aria-label
 * ============================================================ */

window.I18N = (function () {
  'use strict';

  var STORAGE_KEY = 'circlechat_lang';
  var FALLBACK = 'zh';
  // 只用来决定下拉框里的显示顺序，不是白名单——
  // 语言能不能用取决于对应字典是否已加载
  var SUPPORTED = ['zh', 'en', 'ja'];

  // 由 lang/zh.js、lang/en.js、lang/jp.js 等挂载
  var dict = {};

  /** 取 BCP-47 主语言子标签：zh-CN → zh、en-US → en、pt-BR → pt、ja → ja */
  function normalize(code) {
    var c = String(code || '').toLowerCase().trim();
    var m = /^([a-z]{2,3})(?:[-_][a-z0-9]+)*$/.exec(c);
    return m ? m[1] : '';
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

  // current 是「请求值」：i18n.js 先于字典加载，此刻还无法校验该语言是否存在
  var current = detect();

  /**
   * 实际生效的语言：请求的语言字典没加载时回退到 FALLBACK。
   * 保证文案、<html lang>、下拉框选中态三者始终一致——
   * 比如浏览器语言是 fr 而 fr.js 不存在，整站按中文渲染并把中文标记为选中，
   * 而不是文案是中文却把 <html lang> 标成 fr。
   */
  function active() {
    return dict[current] ? current : FALLBACK;
  }

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
    var s = lookup(active(), key);
    if (s === null) s = lookup(FALLBACK, key);
    if (s === null) return key;
    return vars ? interpolate(s, vars) : s;
  }

  function pluralForm(n) {
    try {
      if (window.Intl && window.Intl.PluralRules) {
        return new window.Intl.PluralRules(active()).select(n);
      }
    } catch (e) { /* 老浏览器退回英文规则 */ }
    return n === 1 ? 'one' : 'other';
  }

  /** 带复数的取文案：优先 key.<one|other>，再退到 key 本身 */
  function tn(key, n, vars) {
    var a = active();
    var s = lookup(a, key + '.' + pluralForm(n));
    if (s === null) s = lookup(a, key + '.other');
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
    var used = active();
    document.documentElement.lang = used === 'zh' ? 'zh-CN' : used;
  }

  var listeners = [];

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function set(lang) {
    var n = normalize(lang) || FALLBACK;
    // 只接受已加载字典的语言，避免切到一个没有任何文案的语言
    if (!dict[n]) n = FALLBACK;
    if (n === current) return;
    current = n;
    try { localStorage.setItem(STORAGE_KEY, n); } catch (e) { /* 忽略 */ }
    for (var i = 0; i < listeners.length; i++) listeners[i](n);
  }

  /**
   * 已加载的语言列表，供下拉框渲染。
   * 顺序：先按 SUPPORTED 声明的先后，其余按字典加载顺序追加。
   * name 取该语言自己的 lang.name（语言自称不翻译），
   * 这样新增语言只需加一个字典文件，不必改动任何渲染代码。
   */
  function languages() {
    var out = [];
    var seen = {};
    var codes = SUPPORTED.concat(Object.keys(dict));
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      if (seen[c] || !dict[c]) continue;
      seen[c] = 1;
      var nm = lookup(c, 'lang.name');
      out.push({ code: c, name: nm === null ? c : nm });
    }
    return out;
  }

  return {
    dict: dict,                                   // 供 lang/*.js 挂载
    t: t,
    tn: tn,
    apply: apply,
    set: set,
    onChange: onChange,
    current: function () { return active(); },
    languages: languages
  };
})();
