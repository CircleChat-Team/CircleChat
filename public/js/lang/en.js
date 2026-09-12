/* ============================================================
 * ChatPlus — English strings
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 *
 * Keys must stay in sync with zh.js (same set, same names).
 * Placeholders use {name}; plurals use key.one / key.other.
 * ============================================================ */

(function (root, factory) {
  var dict = factory();
  // Server side can require() the very same file
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dict;
  } else {
    root.I18N = root.I18N || { dict: {} };
    root.I18N.dict.en = dict;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {

    // ---------- Common ----------
    'lang.name': 'English',         // Native name shown in the dropdown, never translated
    'common.theme': 'Toggle dark mode',
    'common.lang': 'Switch language',

    // ---------- Sign-in page ----------
    'login.title': 'ChatPlus · Sign in',
    'login.tag': 'Private chat',
    'login.sub': 'Invited accounts only',
    'login.userPlaceholder': 'Username',
    'login.passPlaceholder': 'Password',
    'login.togglePass': 'Show or hide password',
    'login.showPass': 'Show password',
    'login.hidePass': 'Hide password',
    'login.submit': 'Sign in',
    'login.footer': 'Server: {url}',
    'login.err.failed': 'Sign-in failed',
    'login.err.network': 'Network error, please try again',
    'login.err.empty': 'Please enter your username and password',

    // ---------- Registration request ----------
    'reg.toggle': 'No account? Apply to register (admin approval required)',
    'reg.back': 'Back to sign in',
    'reg.userPlaceholder': 'Username',
    'reg.passPlaceholder': 'Password (at least 6 characters)',
    'reg.pass2Placeholder': 'Confirm password',
    'reg.submit': 'Submit application',
    'reg.ok': 'Application submitted. Please wait for admin approval.',
    'reg.fail': 'Registration failed',
    'reg.short': 'Password must be at least 6 characters',
    'reg.mismatch': 'The two passwords do not match'

  };
});
