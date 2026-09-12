/* ============================================================
 * ChatPlus 私人聊天 — 简体中文文案
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 *
 * 命名规范：<页面>.<模块>[.<子项>]，如 login.err.empty / reg.submit
 * 占位符用 {name}；复数写 key.one / key.other。
 * 新增文案时请同步更新 en.js，两边保持同键同量。
 * ============================================================ */

(function (root, factory) {
  var dict = factory();
  // 服务端可 require() 同一份文案，避免前后端各维护一套
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dict;
  } else {
    root.I18N = root.I18N || { dict: {} };
    root.I18N.dict.zh = dict;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {

    // ---------- 通用 ----------
    'common.theme': '切换深色模式',
    'common.lang': '切换语言',

    // ---------- 登录页 ----------
    'login.title': 'ChatPlus · 登录',
    'login.tag': '私人聊天',
    'login.sub': '仅限受邀账号登录',
    'login.userPlaceholder': '账号',
    'login.passPlaceholder': '密码',
    'login.togglePass': '显示或隐藏密码',
    'login.showPass': '显示密码',
    'login.hidePass': '隐藏密码',
    'login.submit': '登 录',
    'login.footer': '服务地址：{url}',
    'login.err.failed': '登录失败',
    'login.err.network': '网络错误，请重试',
    'login.err.empty': '请输入账号和密码',

    // ---------- 注册申请 ----------
    'reg.toggle': '没有账号？申请注册（需管理员审核）',
    'reg.back': '返回登录',
    'reg.userPlaceholder': '注册账号',
    'reg.passPlaceholder': '密码（至少 6 位）',
    'reg.pass2Placeholder': '确认密码',
    'reg.submit': '提交注册申请',
    'reg.ok': '注册申请已提交，请等待管理员审核',
    'reg.fail': '注册失败',
    'reg.short': '密码至少 6 位',
    'reg.mismatch': '两次输入的密码不一致'

  };
});
