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

    function refreshUsers() {
        var box = $('adminUserList');
        fetch(api('/api/admin/users'), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j.ok) { emptyTip(box, j.error || '加载失败'); return; }
                box.innerHTML = '';
                $('adminCount').textContent = ' · ' + j.users.length + ' 个';
                if (!j.users.length) { emptyTip(box, '暂无账号'); return; }
                j.users.forEach(function (u) { box.appendChild(buildUserRow(u)); });
            })
            .catch(function () { emptyTip(box, '加载失败'); });
    }

    function buildUserRow(u) {
        var row = document.createElement('div');
        row.className = 'admin-user';

        var name = document.createElement('span');
        name.className = 'u-name';
        name.textContent = u.name + (u.name === ME ? '（我）' : '');
        row.appendChild(name);

        if (u.role === 'admin') {
            var role = document.createElement('span');
            role.className = 'u-role';
            role.textContent = '管理员';
            row.appendChild(role);
        }

        var state = document.createElement('span');
        state.className = 'u-state' + (u.online ? ' on' : '');
        state.textContent = u.online ? '在线' : '离线';
        row.appendChild(state);

        var created = document.createElement('span');
        created.className = 'u-created';
        created.textContent = fmtDate(u.created);
        row.appendChild(created);

        var pw = document.createElement('button');
        pw.type = 'button';
        pw.className = 'admin-act';
        pw.textContent = '改密';
        pw.addEventListener('click', function () {
            UI.prompt({
                title: '重置密码',
                text: '为「' + u.name + '」设置新密码（至少 6 位）',
                okText: '确认重置',
                danger: false,
                input: { type: 'password', placeholder: '新密码（至少 6 位）', maxLength: 64 }
            }).then(function (p) {
                if (p == null) return;
                if (p.length < 6) { toast('密码至少 6 位'); return; }
                adminApi('/api/admin/user/pass', { name: u.name, password: p }).then(function (j) {
                    toast(j.ok ? '已重置密码' : (j.error || '操作失败'));
                });
            });
        });
        row.appendChild(pw);

        if (u.name !== ME) {
            var del = document.createElement('button');
            del.type = 'button';
            del.className = 'admin-act danger';
            del.textContent = '删除';
            del.addEventListener('click', function () {
                UI.confirm({
                    title: '删除账号',
                    text: '确定删除账号「' + u.name + '」吗？该操作不可恢复，其历史消息会保留。',
                    okText: '删除'
                }).then(function (ok) {
                    if (!ok) return;
                    adminApi('/api/admin/user/del', { name: u.name }).then(function (j) {
                        toast(j.ok ? '已删除账号 ' + u.name : (j.error || '操作失败'));
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
        if (!name || p.value.length < 6) { toast('请填写用户名，密码至少 6 位'); return; }
        adminApi('/api/admin/user/add', { name: name, password: p.value }).then(function (j) {
            if (!j.ok) { toast(j.error || '添加失败'); return; }
            toast('已添加账号 ' + name);
            n.value = '';
            p.value = '';
            n.focus();
            refreshUsers();
        });
    }

    // ---------- 审计日志 ----------

    var ACTION_LABELS = {
        'login': '登录',
        'login.fail': '登录失败',
        'logout': '退出登录',
        'msg': '发送消息',
        'recall': '撤回消息',
        'upload': '上传文件',
        'settings': '修改设置',
        'admin.user.add': '新建账号',
        'admin.user.del': '删除账号',
        'admin.user.pass': '重置密码'
    };

    function actionLabel(a) {
        return ACTION_LABELS[a] || a;
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
        if (e.ip) row.title = 'IP: ' + e.ip + (e.target ? '　目标: ' + e.target : '');

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
        detail.textContent = e.detail || '';

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
                if (!j.ok) { emptyTip(box, j.error || '加载失败'); return; }
                $('logCount').textContent = ' · ' + j.total + ' 条' +
                    (j.total > j.logs.length ? '（显示最近 ' + j.logs.length + ' 条）' : '');
                box.innerHTML = '';
                if (!j.logs.length) { emptyTip(box, '暂无日志'); return; }
                j.logs.forEach(function (e) { box.appendChild(buildLogRow(e)); });
            })
            .catch(function () { emptyTip(box, '加载失败'); });
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
                $('adminMe').textContent = '管理员 ' + ME;

                $('adminBack').addEventListener('click', function () { location.href = '/chat.html'; });
                $('themeBtn').addEventListener('click', toggleTheme);
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
                refreshLogs();
            })
            .catch(function () { location.replace('/login.html'); });
    }

    document.addEventListener('DOMContentLoaded', boot);
})();
