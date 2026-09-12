'use strict';
/* ============================================================
 * ChatPlus 私人聊天 — 管理页脚本（用户管理）
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * 仅管理员可用：非管理员登录会被跳回聊天页。
 * ============================================================ */

(function () {
    var CFG = window.CHAT_CONFIG || {};

    // ---------- 工具 ----------

    function apiBase() {
        return String(CFG.apiBase || '').replace(/\/+$/, '');
    }
    function api(path) { return apiBase() + path; }
    function $(id) { return document.getElementById(id); }

    // ---------- 国际化 ----------
    var I18N = window.I18N;
    function tr(key, vars) { return I18N ? I18N.t(key, vars) : key; }
    function trn(key, n, vars) { return I18N ? I18N.tn(key, n, vars) : key; }
    function applyLang() {
      if (I18N) I18N.apply();
      document.title = tr('admin.title');
      refreshApprovals();
      refreshUsers();
      refreshLogs();
    }

    var toastEl = $('toast');
    var ME = null;

    function toast(msg, ms) {
        toastEl.textContent = msg;
        toastEl.classList.remove('hidden');
        clearTimeout(toastEl._t);
        toastEl._t = setTimeout(function () { toastEl.classList.add('hidden'); }, ms || 2500);
    }

    function fmtDate(ts) {
        if (!ts) return '—';
        var d = new Date(ts);
        function p(n) { return n < 10 ? '0' + n : '' + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    // ---------- 主题（深色模式，与管理页之外的设置共用） ----------

    var ICON_MOON = '<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.33-9.62A9.05 9.05 0 0 0 12 3z"></path>';
    var ICON_SUN = '<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm-9-3H1v2h2v-2zm20 0h-2v2h2v-2zM6.34 6.34 4.93 4.93l1.41-1.41 1.41 1.41L6.34 6.34zm12.02 12.02-1.41 1.41 1.41 1.41 1.41-1.41-1.41-1.41zM4.93 19.07l1.41-1.41 1.41 1.41-1.41 1.41-1.41-1.41zm12.02-12.02 1.41-1.41 1.41 1.41-1.41 1.41-1.41-1.41z"></path>';

    function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); }

    function currentTheme() {
        var s;
        try { s = localStorage.getItem('chatplus_theme'); } catch (e) { s = null; }
        if (s === 'dark' || s === 'light') return s;
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }

    function updateThemeIcon() {
        var icon = $('themeIcon');
        if (icon) icon.innerHTML = currentTheme() === 'dark' ? ICON_SUN : ICON_MOON;
    }

    function toggleTheme() {
        var t = currentTheme() === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('chatplus_theme', t); } catch (e) { /* 忽略 */ }
        applyTheme(t);
        updateThemeIcon();
    }

    applyTheme(currentTheme()); // 尽早应用，避免闪烁

    // ---------- 用户管理 ----------

    function adminApi(path, payload) {
        return fetch(api(path), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        }).then(function (r) { return r.json(); });
    }

    function emptyTip(box, text) {
        box.innerHTML = '';
        var d = document.createElement('div');
        d.className = 'admin-empty';
        d.textContent = text;
        box.appendChild(d);
    }

    // ---------- 注册申请审核 ----------

    function refreshApprovals() {
        var box = $('approvalList');
        if (!box) return;
        fetch(api('/api/admin/approvals'), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j.ok) { emptyTip(box, j.error || tr('common.loadFailed')); return; }
                box.innerHTML = '';
                $('approvalCount').textContent = trn('admin.count.items', j.approvals.length);
                if (!j.approvals.length) { emptyTip(box, tr('admin.pending.empty')); return; }
                j.approvals.forEach(function (a) { box.appendChild(buildApprovalRow(a)); });
            })
            .catch(function () { emptyTip(box, tr('common.loadFailed')); });
    }

    function buildApprovalRow(a) {
        var row = document.createElement('div');
        row.className = 'admin-user';

        var name = document.createElement('span');
        name.className = 'u-name';
        name.textContent = a.name;
        row.appendChild(name);

        var created = document.createElement('span');
        created.className = 'u-created';
        created.textContent = tr('admin.created.at', { date: fmtDate(a.created) });
        row.appendChild(created);

        var appr = document.createElement('button');
        appr.type = 'button';
        appr.className = 'admin-act';
        appr.textContent = tr('admin.approve.btn');
        appr.addEventListener('click', function () {
            adminApi('/api/admin/review/approve', { name: a.name }).then(function (j) {
                toast(j.ok ? tr('admin.approved', { name: a.name }) : (j.error || tr('common.opFailed')));
                if (j.ok) { refreshApprovals(); refreshUsers(); }
            });
        });
        row.appendChild(appr);

        var rej = document.createElement('button');
        rej.type = 'button';
        rej.className = 'admin-act danger';
        rej.textContent = tr('admin.reject.btn');
        rej.addEventListener('click', function () {
            if (!window.confirm(tr('admin.reject.confirm', { name: a.name }))) return;
            adminApi('/api/admin/review/reject', { name: a.name }).then(function (j) {
                toast(j.ok ? tr('admin.rejected', { name: a.name }) : (j.error || tr('common.opFailed')));
                if (j.ok) refreshApprovals();
            });
        });
        row.appendChild(rej);

        return row;
    }

    function refreshUsers() {
        var box = $('adminUserList');
        fetch(api('/api/admin/users'), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j.ok) { emptyTip(box, j.error || tr('common.loadFailed')); return; }
                box.innerHTML = '';
                $('adminCount').textContent = trn('admin.count.users', j.users.length);
                if (!j.users.length) { emptyTip(box, tr('admin.users.empty')); return; }
                j.users.forEach(function (u) { box.appendChild(buildUserRow(u)); });
            })
            .catch(function () { emptyTip(box, tr('common.loadFailed')); });
    }

    function buildUserRow(u) {
        var row = document.createElement('div');
        row.className = 'admin-user';

        var name = document.createElement('span');
        name.className = 'u-name';
        name.textContent = u.name + (u.name === ME ? tr('common.me') : '');
        row.appendChild(name);

        if (u.role === 'admin') {
            var role = document.createElement('span');
            role.className = 'u-role';
            role.textContent = tr('common.admin');
            row.appendChild(role);
        }

        var state = document.createElement('span');
        state.className = 'u-state' + (u.online ? ' on' : '');
        state.textContent = u.online ? tr('common.online') : tr('common.offline');
        row.appendChild(state);

        var created = document.createElement('span');
        created.className = 'u-created';
        created.textContent = fmtDate(u.created);
        row.appendChild(created);

        var pw = document.createElement('button');
        pw.type = 'button';
        pw.className = 'admin-act';
        pw.textContent = tr('admin.users.changePass');
        pw.addEventListener('click', function () {
            UI.prompt({
                title: tr('admin.users.resetTitle'),
                text: tr('admin.users.resetPrompt', { name: u.name }),
                okText: tr('admin.users.resetOk'),
                danger: false,
                input: { type: 'password', placeholder: tr('admin.users.newPassPlaceholder'), maxLength: 64 }
            }).then(function (p) {
                if (p == null) return;
                if (p.length < 6) { toast(tr('reg.short')); return; }
                adminApi('/api/admin/user/pass', { name: u.name, password: p }).then(function (j) {
                    toast(j.ok ? tr('admin.users.passReset') : (j.error || tr('common.opFailed')));
                });
            });
        });
        row.appendChild(pw);

        if (u.name !== ME) {
            var del = document.createElement('button');
            del.type = 'button';
            del.className = 'admin-act danger';
            del.textContent = tr('admin.users.delBtn');
            del.addEventListener('click', function () {
                UI.confirm({
                    title: tr('admin.users.delTitle'),
                    text: tr('admin.users.delConfirm', { name: u.name }),
                    okText: tr('admin.users.delBtn')
                }).then(function (ok) {
                    if (!ok) return;
                    adminApi('/api/admin/user/del', { name: u.name }).then(function (j) {
                        toast(j.ok ? tr('admin.users.deleted', { name: u.name }) : (j.error || tr('common.opFailed')));
                        if (j.ok) refreshUsers();
                    });
                });
            });
            row.appendChild(del);
        }
        return row;
    }

    function addUser() {
        var n = $('adminNewName');
        var p = $('adminNewPass');
        var name = n.value.trim();
        if (!name || p.value.length < 6) { toast(tr('admin.add.validate')); return; }
        adminApi('/api/admin/user/add', { name: name, password: p.value }).then(function (j) {
            if (!j.ok) { toast(j.error || tr('admin.add.fail')); return; }
            toast(tr('admin.added', { name: name }));
            n.value = '';
            p.value = '';
            n.focus();
            refreshUsers();
        });
    }

    // ---------- 审计日志 ----------

    // 审计动作 → 文案 key（下拉框选项与日志标签共用同一批 key）
    var ACTION_KEYS = {
        'login': 'admin.action.login',
        'login.fail': 'admin.action.loginFail',
        'logout': 'admin.action.logout',
        'msg': 'admin.action.msg',
        'group.msg': 'admin.action.groupMsg',
        'dm.msg': 'admin.action.dmMsg',
        'recall': 'admin.action.recall',
        'group.recall': 'admin.action.groupRecall',
        'dm.recall': 'admin.action.dmRecall',
        'upload': 'admin.action.upload',
        'settings': 'admin.action.settings',
        'register': 'admin.action.register',
        'friend.request': 'admin.action.friendRequest',
        'friend.accept': 'admin.action.friendAccept',
        'admin.review.approve': 'admin.action.approve',
        'admin.review.reject': 'admin.action.reject',
        'admin.user.add': 'admin.action.userAdd',
        'admin.user.del': 'admin.action.userDel',
        'admin.user.pass': 'admin.action.userPass',
        'group.create': 'admin.action.groupCreate',
        'group.dissolve': 'admin.action.groupDissolve',
        'group.join': 'admin.action.groupJoin',
        'group.leave': 'admin.action.groupLeave',
        'group.rename': 'admin.action.groupRename'
    };

    function actionLabel(a) {
        var k = ACTION_KEYS[a];
        return k ? tr(k) : a;
    }

    // 审计详情：新格式为 JSON {k: i18n 键, v: 变量}，按当前语言翻译；
    // 旧版写死的中文详情无法解析时原样显示
    function formatDetail(d) {
        if (!d) return '';
        try {
            var o = JSON.parse(d);
            if (o && typeof o === 'object' && typeof o.k === 'string') {
                return tr(o.k, o.v || {});
            }
        } catch (e) { /* 旧版中文详情，原样显示 */ }
        return d;
    }

    function fmtDateTime(ts) {
        var d = new Date(Number(ts) || 0);
        function p(n) { return n < 10 ? '0' + n : '' + n; }
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
               p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    function buildLogRow(e) {
        var row = document.createElement('div');
        row.className = 'admin-log' + (e.action === 'login.fail' ? ' warn' : '');
        if (e.ip) row.title = 'IP: ' + e.ip + (e.target ? tr('admin.log.target') + e.target : '');

        var time = document.createElement('span');
        time.className = 'lg-time';
        time.textContent = fmtDateTime(e.ts);

        var actor = document.createElement('span');
        actor.className = 'lg-actor';
        actor.textContent = e.actor || '—';

        var act = document.createElement('span');
        act.className = 'lg-action';
        act.textContent = actionLabel(e.action);

        var detail = document.createElement('span');
        detail.className = 'lg-detail';
        detail.textContent = formatDetail(e.detail);

        row.appendChild(time);
        row.appendChild(actor);
        row.appendChild(act);
        row.appendChild(detail);
        return row;
    }

    function refreshLogs() {
        var box = $('adminLogList');
        var actor = $('logActor').value.trim();
        var action = $('logAction').value;
        var url = '/api/admin/logs?limit=200';
        if (actor) url += '&actor=' + encodeURIComponent(actor);
        if (action) url += '&action=' + encodeURIComponent(action);

        fetch(api(url), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j.ok) { emptyTip(box, j.error || tr('common.loadFailed')); return; }
                $('logCount').textContent = trn('admin.count.items', j.total) +
                    (j.total > j.logs.length ? tr('admin.log.shown', { n: j.logs.length }) : '');
                box.innerHTML = '';
                if (!j.logs.length) { emptyTip(box, tr('admin.log.empty')); return; }
                j.logs.forEach(function (e) { box.appendChild(buildLogRow(e)); });
            })
            .catch(function () { emptyTip(box, tr('common.loadFailed')); });
    }

    function doLogout() {
        fetch(api('/api/logout'), { method: 'POST', credentials: 'same-origin' })
            .catch(function () { /* 忽略 */ });
        ME = null;
        location.replace('/login.html');
    }

    // ---------- 鉴权守卫 ----------

    function boot() {
        fetch(api('/api/me'), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j.ok) { location.replace('/login.html'); return; }
                if (j.role !== 'admin') { location.replace('/chat.html'); return; } // 非管理员不可进
                ME = j.username;
                $('adminMe').textContent = tr('admin.me.label', { name: ME });

                $('adminBack').addEventListener('click', function () { location.href = '/chat.html'; });
                $('themeBtn').addEventListener('click', toggleTheme);

      // ---------- 语言下拉 ----------
      var langMenuOpen = false;
      function renderLangMenu() {
        var menu = $('langMenu');
        if (!menu || !I18N) return;
        var langs = I18N.languages();
        var cur = I18N.current();
        menu.innerHTML = '';
        for (var i = 0; i < langs.length; i++) {
          var code = langs[i].code;
          var isActive = code === cur;
          var item = document.createElement('button');
          item.type = 'button';
          item.className = 'lang-item' + (isActive ? ' is-active' : '');
          item.setAttribute('role', 'menuitemradio');
          item.setAttribute('aria-checked', isActive ? 'true' : 'false');
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
        if (open) { renderLangMenu(); menu.classList.remove('hidden'); }
        else menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      $('langBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        setLangMenu(!langMenuOpen);
      });
      $('langMenu').addEventListener('click', function (e) {
        var code = e.target && e.target.getAttribute ? e.target.getAttribute('data-lang') : null;
        if (!code) return;
        I18N.set(code);
        setLangMenu(false);
      });
      document.addEventListener('click', function () { if (langMenuOpen) setLangMenu(false); });
      document.addEventListener('keydown', function (e) {
        if (langMenuOpen && (e.key === 'Escape' || e.keyCode === 27)) setLangMenu(false);
      });
      applyLang();
      if (I18N) I18N.onChange(applyLang);
                updateThemeIcon();
                $('logoutBtn').addEventListener('click', doLogout);
                $('adminAddBtn').addEventListener('click', addUser);
                $('adminNewName').addEventListener('keydown', function (e) {
                    if (e.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter') { e.preventDefault(); $('adminNewPass').focus(); }
                });
                $('adminNewPass').addEventListener('keydown', function (e) {
                    if (e.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter') { e.preventDefault(); addUser(); }
                });

                // 审计日志：筛选与刷新
                $('logRefresh').addEventListener('click', refreshLogs);
                $('logAction').addEventListener('change', refreshLogs);
                $('logActor').addEventListener('keydown', function (e) {
                    if (e.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter') { e.preventDefault(); refreshLogs(); }
                });

                refreshUsers();
                refreshApprovals();
                $('approvalRefresh').addEventListener('click', refreshApprovals);
                refreshLogs();
            })
            .catch(function () { location.replace('/login.html'); });
    }

    document.addEventListener('DOMContentLoaded', boot);
})();
