/* ============================================================
 * ChatPlus 私人聊天 — 登录页逻辑
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * ============================================================ */

(function () {
  'use strict';

  var CFG = window.CHAT_CONFIG || {};
  var I18N = window.I18N;

  function t(key, vars) { return I18N ? I18N.t(key, vars) : key; }

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

  // 主题图标（与 chat.js 保持一致）
  var ICON_MOON = '<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.33-9.62A9.05 9.05 0 0 0 12 3z"></path>';
  var ICON_SUN = '<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm-9-3H1v2h2v-2zm20 0h-2v2h2v-2zM6.34 6.34 4.93 4.93l1.41-1.41 1.41 1.41L6.34 6.34zm12.02 12.02-1.41 1.41 1.41 1.41 1.41-1.41-1.41-1.41zM4.93 19.07l1.41-1.41 1.41 1.41-1.41 1.41-1.41-1.41zm12.02-12.02 1.41-1.41 1.41 1.41-1.41 1.41-1.41-1.41z"></path>';

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
    if (!btn || !txt) return;
    btn.disabled = on;
    // 转圈动画需要 innerHTML；纯文案一律走 textContent，避免字典内容被当标签解析
    if (on) txt.innerHTML = '<span class="spinner"></span>';
    else txt.textContent = t('login.submit');
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
          // 服务端错误文案暂由 server.js 返回，尚未接入字典（见 README 的后续计划）
          $('loginErr').textContent = res.body.error || t('login.err.failed');
        }
      })
      .catch(function () { setLoading(false); $('loginErr').textContent = t('login.err.network'); });
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
      toggleBtn.textContent = t('reg.back');
      $('regUser').focus();
    } else {
      regForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      hint.classList.add('hidden');
      toggleBtn.textContent = t('reg.toggle');
      $('loginUser').focus();
    }
    $('loginErr').textContent = '';
  }

  function doRegister() {
    var u = $('regUser').value.trim();
    var p = $('regPass').value;
    var p2 = $('regPass2').value;
    $('registerHint').classList.add('hidden');
    if (!u || !p) { $('registerHint').textContent = t('login.err.empty'); $('registerHint').classList.remove('hidden'); return; }
    if (p.length < 6) { $('registerHint').textContent = t('reg.short'); $('registerHint').classList.remove('hidden'); return; }
    if (p !== p2) { $('registerHint').textContent = t('reg.mismatch'); $('registerHint').classList.remove('hidden'); return; }
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
        txt.textContent = t('reg.submit');
        if (res.body.ok) {
          $('regUser').value = '';
          $('regPass').value = '';
          $('regPass2').value = '';
          $('registerHint').textContent = res.body.message || t('reg.ok');
          $('registerHint').classList.remove('hidden');
          $('loginUser').value = u; // 方便审核通过后直接输入密码登录
          toggleRegister(false);
        } else {
          $('registerHint').textContent = res.body.error || t('reg.fail');
          $('registerHint').classList.remove('hidden');
        }
      })
      .catch(function () {
        btn.disabled = false;
        txt.textContent = t('reg.submit');
        $('registerHint').textContent = t('login.err.network');
        $('registerHint').classList.remove('hidden');
      });
  }

  // ---------- 主题（深色模式） ----------

  function currentTheme() {
    var s;
    try { s = localStorage.getItem('chatplus_theme'); } catch (e) { s = null; }
    if (s === 'dark' || s === 'light') return s;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function applyTheme(th) { document.documentElement.setAttribute('data-theme', th); }
  function updateThemeIcon() {
    var icon = $('themeIcon');
    if (icon) icon.innerHTML = currentTheme() === 'dark' ? ICON_SUN : ICON_MOON;
  }
  function toggleTheme() {
    var th = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('chatplus_theme', th); } catch (e) { /* 忽略 */ }
    applyTheme(th);
    updateThemeIcon();
  }

  // ---------- 语言 ----------

  var langMenuOpen = false;

  // 选项来自已加载的字典；语言名用各自语言的自称，不参与翻译。
  // 新增语言只需加一个 lang/xx.js，这里不用改。
  function renderLangMenu() {
    var menu = $('langMenu');
    if (!menu || !I18N) return;
    var langs = I18N.languages();
    var cur = I18N.current();
    menu.innerHTML = '';
    for (var i = 0; i < langs.length; i++) {
      var code = langs[i].code;
      var active = code === cur;
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'lang-item' + (active ? ' is-active' : '');
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', active ? 'true' : 'false');
      item.setAttribute('data-lang', code);
      item.textContent = langs[i].name;
      menu.appendChild(item);
    }
  }

  function setLangMenu(open) {
    var menu = $('langMenu');
    var btn = $('langBtn');
    if (!menu || !btn) return;
    langMenuOpen = open;
    if (open) {
      renderLangMenu();          // 每次打开都重建，保证勾选状态最新
      menu.classList.remove('hidden');
    } else {
      menu.classList.add('hidden');
    }
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /**
   * 重刷动态文案。
   * 静态节点（含 placeholder / title）由 I18N.apply() 统一处理，
   * 这里是那些文案随状态变化的元素。
   */
  function refreshDynamicTexts() {
    $('loginFooter').textContent = t('login.footer', { url: displayBase() });

    var regOn = !$('registerForm').classList.contains('hidden');
    $('toggleRegister').textContent = t(regOn ? 'reg.back' : 'reg.toggle');

    // 正在提交时按钮里是转圈动画，不要覆盖
    var loginBtn = $('loginBtn');
    if (loginBtn && !loginBtn.disabled) $('loginBtnText').textContent = t('login.submit');
    var regBtn = $('regBtn');
    if (regBtn && !regBtn.disabled) $('regBtnText').textContent = t('reg.submit');

    var togglePass = $('togglePass');
    if (togglePass) {
      var passInput = $('loginPass');
      togglePass.title = passInput && passInput.type === 'text' ? t('login.hidePass') : t('login.showPass');
    }
  }

  function applyLang() {
    if (I18N) I18N.apply();
    refreshDynamicTexts();
  }

  function init() {
    // 尽早应用主题，避免页面闪烁
    applyTheme(currentTheme());
    updateThemeIcon();

    // 语言：脚本位于 body 末尾，此时应用基本赶在首次绘制之前
    applyLang();
    if (I18N) {
      I18N.onChange(applyLang);

      // 语言下拉：点按钮开合，选项由 renderLangMenu() 动态生成
      $('langBtn').addEventListener('click', function (e) {
        e.stopPropagation();               // 别让下面那个「点空白关闭」立刻把它关掉
        setLangMenu(!langMenuOpen);
      });
      $('langMenu').addEventListener('click', function (e) {
        var code = e.target && e.target.getAttribute ? e.target.getAttribute('data-lang') : null;
        if (!code) return;
        I18N.set(code);
        setLangMenu(false);
      });
      // 点击别处或按 Esc 收起
      document.addEventListener('click', function () { if (langMenuOpen) setLangMenu(false); });
      document.addEventListener('keydown', function (e) {
        if (langMenuOpen && (e.key === 'Escape' || e.keyCode === 27)) setLangMenu(false);
      });
    }
    $('themeBtn').addEventListener('click', toggleTheme);

    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var u = $('loginUser').value.trim();
      var p = $('loginPass').value;
      if (!u || !p) { $('loginErr').textContent = t('login.err.empty'); return; }
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
      toggleBtn.title = showing ? t('login.showPass') : t('login.hidePass');
      passInput.focus();
    });

    // 已登录则直接进入聊天页
    fetch(api('/api/me'), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) redirectAfterLogin(); })
      .catch(function () { /* 忽略，停留在登录页 */ });
  }

  // 脚本在 body 末尾：DOM 多半已解析完，直接初始化能减少文案闪烁
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
