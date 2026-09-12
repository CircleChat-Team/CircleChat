/* ============================================================
 * ChatPlus 私人聊天 — 登录页逻辑
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * ============================================================ */

(function () {
  'use strict';

  var CFG = window.CHAT_CONFIG || {};

  function apiBase() {
    return String(CFG.apiBase || '').replace(/\/+$/, '');
  }
  function displayBase() {
    if (CFG.displayBase) return String(CFG.displayBase).replace(/\/+$/, '');
    return location.origin;
  }
  function api(path) {
    return apiBase() + path;
  }
  function $(id) { return document.getElementById(id); }

  // 密码显隐图标
  var EYE_ON = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"></path>';
  var EYE_OFF = '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2z"></path>';

  function redirectAfterLogin() {
    var next = '';
    try { next = new URLSearchParams(location.search).get('next') || ''; } catch (e) { /* 忽略 */ }
    // 仅允许站内相对路径（/ 开头），避免被重定向到外部站点
    // 注意：页面间跳转使用同源路径，不要加 apiBase()（apiBase 仅用于 API 请求）
    var target = (next.charAt(0) === '/' && next.indexOf('//') !== 0) ? next : '/chat.html';
    location.replace(target);
  }

  function setLoading(on) {
    var btn = $('loginBtn');
    var txt = $('loginBtnText');
    if (!btn) return;
    btn.disabled = on;
    txt.innerHTML = on ? '<span class="spinner"></span>' : '登 录';
  }

  function doLogin(username, password) {
    $('loginErr').textContent = '';
    setLoading(true);
    fetch(api('/api/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.body.ok) {
          redirectAfterLogin();
        } else {
          setLoading(false);
          $('loginErr').textContent = res.body.error || '登录失败';
        }
      })
      .catch(function () { setLoading(false); $('loginErr').textContent = '网络错误，请重试'; });
  }

  function doLogout() {
    fetch(api('/api/logout'), { method: 'POST', credentials: 'same-origin' })
        .catch(function () { /* 忽略 */ });
    location.replace('/login.html');
  }

  // 显示 / 隐藏注册表单，并切换标题提示文案
  function toggleRegister(show) {
    var loginForm = $('loginForm');
    var regForm = $('registerForm');
    var toggleBtn = $('toggleRegister');
    var hint = $('registerHint');
    if (show) {
      loginForm.classList.add('hidden');
      regForm.classList.remove('hidden');
      hint.classList.add('hidden');
      toggleBtn.textContent = '返回登录';
      $('regUser').focus();
    } else {
      regForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      hint.classList.add('hidden');
      toggleBtn.textContent = '没有账号？申请注册（需管理员审核）';
      $('loginUser').focus();
    }
    $('loginErr').textContent = '';
  }

  function doRegister() {
    var u = $('regUser').value.trim();
    var p = $('regPass').value;
    var p2 = $('regPass2').value;
    $('registerHint').classList.add('hidden');
    if (!u || !p) { $('registerHint').textContent = '请填写账号和密码'; $('registerHint').classList.remove('hidden'); return; }
    if (p.length < 6) { $('registerHint').textContent = '密码至少 6 位'; $('registerHint').classList.remove('hidden'); return; }
    if (p !== p2) { $('registerHint').textContent = '两次输入的密码不一致'; $('registerHint').classList.remove('hidden'); return; }
    var btn = $('regBtn');
    var txt = $('regBtnText');
    btn.disabled = true;
    txt.innerHTML = '<span class="spinner"></span>';
    fetch(api('/api/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ name: u, password: p })
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        txt.textContent = '提交注册申请';
        if (res.body.ok) {
          $('regUser').value = '';
          $('regPass').value = '';
          $('regPass2').value = '';
          $('registerHint').textContent = res.body.message || '注册申请已提交，请等待管理员审核';
          $('registerHint').classList.remove('hidden');
          $('loginUser').value = u; // 方便审核通过后直接输入密码登录
          toggleRegister(false);
        } else {
          $('registerHint').textContent = res.body.error || '注册失败';
          $('registerHint').classList.remove('hidden');
        }
      })
      .catch(function () {
        btn.disabled = false;
        txt.textContent = '提交注册申请';
        $('registerHint').textContent = '网络错误，请重试';
        $('registerHint').classList.remove('hidden');
      });
  }

  function init() {
    // 应用深色模式（跟随本地存储 / 系统偏好，登录页仅应用不提供切换）
    var saved;
    try { saved = localStorage.getItem('chatplus_theme'); } catch (e) { saved = null; }
    var dark = saved === 'dark' || (saved !== 'light' &&
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

    $('loginFooter').textContent = '服务地址：' + displayBase();

    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var u = $('loginUser').value.trim();
      var p = $('loginPass').value;
      if (!u || !p) { $('loginErr').textContent = '请输入账号和密码'; return; }
      doLogin(u, p);
    });

    // 注册表单切换与提交
    $('toggleRegister').addEventListener('click', function () {
      toggleRegister($('registerForm').classList.contains('hidden'));
    });
    $('registerForm').addEventListener('submit', function (e) {
      e.preventDefault();
      doRegister();
    });
    $('loginForm').classList.remove('hidden');

    // 密码显隐切换
    var passInput = $('loginPass');
    var toggleBtn = $('togglePass');
    var toggleIcon = $('togglePassIcon');
    toggleBtn.addEventListener('click', function () {
      var showing = passInput.type === 'text';
      passInput.type = showing ? 'password' : 'text';
      toggleIcon.innerHTML = showing ? EYE_ON : EYE_OFF;
      toggleBtn.title = showing ? '显示密码' : '隐藏密码';
      passInput.focus();
    });

    // 已登录则直接进入聊天页
    fetch(api('/api/me'), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) redirectAfterLogin(); })
      .catch(function () { /* 忽略，停留在登录页 */ });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
