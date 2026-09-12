'use strict';
/* ============================================================
 * ChatPlus 私人聊天 — 群管理面板脚本
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * 功能：群信息(重命名/删除/转移群主)、入群申请审核、成员管理、
 *       群文件管理。群主本人或系统管理员可用；管理员可管理任意群。
 * ============================================================ */

(function () {
    var CFG = window.CHAT_CONFIG || {};

    function apiBase() {
        return String(CFG.apiBase || '').replace(/\/+$/, '');
    }
    function api(path) { return apiBase() + path; }
    function $(id) { return document.getElementById(id); }

    var toastEl = $('toast');
    var GID = null;          // 当前管理的群 id
    var IS_ADMIN = false;
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

    function fmtSize(n) {
        if (!n) return;
        var v = Number(n);
        if (v < 1024) return v + ' B';
        if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
        return (v / 1048576).toFixed(1) + ' MB';
    }

    // ---------- 主题 ----------

    var ICON_MOON = '<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.33-9.62A9.05 9.05 0 0 0 12 3z"></path>';
    var ICON_SUN = '<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm-9-3H1v2h2v-2zm20 0h-2v2h2v-2zM6.34 6.34 4.93 4.93l1.41-1.41 1.41 1.41L6.34 6.34zm12.02 12.02-1.41 1.41 1.41 1.41 1.41-1.41-1.41zM4.93 19.07l1.41-1.41 1.41 1.41-1.41 1.41-1.41-1.41zm12.02-12.02 1.41-1.41 1.41 1.41-1.41 1.41-1.41z"></path>';

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

    applyTheme(currentTheme());

    // ---------- 工具 ----------

    function apiPost(path, payload) {
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

    // ---------- 群选择器 ----------

    function loadGroupSelector() {
        var url = IS_ADMIN ? '/api/groups/all' : '/api/groups';
        return fetch(api(url), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j.ok) throw new Error(j.error || '加载失败');
                var groups = j.groups || [];
                var sel = $('groupSelect');
                sel.innerHTML = '';
                if (!groups.length) {
                    var opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = '（暂无群）';
                    sel.appendChild(opt);
                    sel.disabled = true;
                    return null;
                }
                groups.forEach(function (g) {
                    var opt = document.createElement('option');
                    opt.value = g.id;
                    opt.textContent = g.name + '（群主：' + g.owner + '）';
                    sel.appendChild(opt);
                });
                return groups;
            });
    }

    // ---------- 渲染单群 ----------

    function renderInfo(j) {
        var box = $('groupInfo');
        var g = j.group;
        box.innerHTML = '';
        var row = document.createElement('div');
        row.className = 'admin-log';
        var name = document.createElement('span');
        name.className = 'lg-action';
        name.textContent = g.name;
        var owner = document.createElement('span');
        owner.className = 'lg-detail';
        owner.textContent = '群主：' + g.owner + (j.isOwner ? '（我）' : '') + '　创建于 ' + fmtDate(g.created);
        row.appendChild(name);
        row.appendChild(owner);
        box.appendChild(row);
    }

    function renderRequests(requests) {
        var box = $('reqList');
        box.innerHTML = '';
        $('reqCount').textContent = ' · ' + requests.length + ' 条';
        if (!requests.length) { emptyTip(box, '暂无待审核的入群申请'); return; }
        requests.forEach(function (r) {
            var row = document.createElement('div');
            row.className = 'admin-user';
            var nm = document.createElement('span');
            nm.className = 'u-name';
            nm.textContent = r.name;
            row.appendChild(nm);
            var cr = document.createElement('span');
            cr.className = 'u-created';
            cr.textContent = fmtDate(r.created) + ' 申请';
            row.appendChild(cr);
            var ok = document.createElement('button');
            ok.type = 'button';
            ok.className = 'admin-act';
            ok.textContent = '通过';
            ok.addEventListener('click', function () {
                apiPost('/api/groups/request/approve', { gid: GID, name: r.name }).then(function (j) {
                    toast(j.ok ? '已通过 ' + r.name : (j.error || '操作失败'));
                    if (j.ok) loadGroup();
                });
            });
            row.appendChild(ok);
            var no = document.createElement('button');
            no.type = 'button';
            no.className = 'admin-act danger';
            no.textContent = '拒绝';
            no.addEventListener('click', function () {
                UI.confirm({ title: '拒绝入群', text: '拒绝「' + r.name + '」加入该群？', okText: '拒绝' })
                    .then(function (okk) {
                        if (!okk) return;
                        apiPost('/api/groups/request/reject', { gid: GID, name: r.name }).then(function (j) {
                            toast(j.ok ? '已拒绝 ' + r.name : (j.error || '操作失败'));
                            if (j.ok) loadGroup();
                        });
                    });
            });
            row.appendChild(no);
            box.appendChild(row);
        });
    }

    function renderMembers(members, online) {
        var box = $('memList');
        box.innerHTML = '';
        $('memCount').textContent = ' · ' + members.length + ' 人';
        if (!members.length) { emptyTip(box, '暂无成员'); return; }
        members.forEach(function (m) {
            var row = document.createElement('div');
            row.className = 'admin-user';
            var nm = document.createElement('span');
            nm.className = 'u-name';
            nm.textContent = m.name + (m.name === ME ? '（我）' : '');
            row.appendChild(nm);
            if (m.owner) {
                var owner = document.createElement('span');
                owner.className = 'u-role';
                owner.textContent = '群主';
                row.appendChild(owner);
            }
            var st = document.createElement('span');
            st.className = 'u-state' + (online && online.has(m.name) ? ' on' : '');
            st.textContent = online && online.has(m.name) ? '在线' : '离线';
            row.appendChild(st);
            var cr = document.createElement('span');
            cr.className = 'u-created';
            cr.textContent = fmtDate(m.joined);
            row.appendChild(cr);
            if (!m.owner) {
                var del = document.createElement('button');
                del.type = 'button';
                del.className = 'admin-act danger';
                del.textContent = '移除';
                del.addEventListener('click', function () {
                    UI.confirm({ title: '移除成员', text: '将「' + m.name + '」移出该群？', okText: '移除' })
                        .then(function (ok) {
                            if (!ok) return;
                            apiPost('/api/groups/members/remove', { gid: GID, name: m.name }).then(function (j) {
                                toast(j.ok ? '已移除 ' + m.name : (j.error || '操作失败'));
                                if (j.ok) loadGroup();
                            });
                        });
                });
                row.appendChild(del);
            }
            box.appendChild(row);
        });
    }

    function renderFiles(files) {
        var box = $('fileList');
        box.innerHTML = '';
        $('fileCount').textContent = ' · ' + files.length + ' 个';
        if (!files.length) { emptyTip(box, '该群暂无图片/文件'); return; }
        files.forEach(function (f) {
            var row = document.createElement('div');
            row.className = 'admin-log';
            row.title = f.content;
            var type = document.createElement('span');
            type.className = 'lg-action';
            type.textContent = f.type === 'image' ? '[图片]' : '[文件]';
            row.appendChild(type);
            var nm = document.createElement('span');
            nm.className = 'lg-detail';
            nm.textContent = (f.type === 'image' ? '图片' : (f.name || '文件')) +
                (f.size ? '（' + fmtSize(f.size) + '）' : '') + '　' + fmtDate(f.ts);
            row.appendChild(nm);
            var del = document.createElement('button');
            del.type = 'button';
            del.className = 'admin-act danger';
            del.textContent = '删除';
            del.addEventListener('click', function () {
                UI.confirm({ title: '删除群文件', text: '删除该图片/文件？该操作不可恢复。', okText: '删除' })
                    .then(function (ok) {
                        if (!ok) return;
                        apiPost('/api/groups/file/delete', { gid: GID, idx: f.idx }).then(function (j) {
                            toast(j.ok ? '已删除' : (j.error || '操作失败'));
                            if (j.ok) loadGroup();
                        });
                    });
            });
            row.appendChild(del);
            box.appendChild(row);
        });
    }

    function loadGroup() {
        if (!GID) return;
        fetch(api('/api/groups/manage?gid=' + encodeURIComponent(GID)), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j.ok) {
                    toast(j.error || '加载失败');
                    $('groupInfo').textContent = j.error || '无法加载该群';
                    return;
                }
                var online = null;
                return fetch(api('/api/me'), { credentials: 'same-origin' })
                    .then(function (r) { return r.json(); })
                    .then(function (m) { online = new Set(m.ok ? (m.online || []) : []); return j; })
                    .then(function () { renderInfo(j); renderRequests(j.requests); renderMembers(j.members, online); renderFiles(j.files); });
            })
            .catch(function () { toast('加载失败'); });
    }

    // ---------- 操作 ----------

    function renameGroup() {
        UI.prompt({
            title: '重命名群聊',
            text: '输入新的群名（1-24 位字母/数字/下划线/中文/点/横线）：',
            placeholder: '新群名',
            okText: '保存',
            input: { type: 'text', placeholder: '新群名', maxLength: 24 }
        }).then(function (name) {
            if (name == null) return;
            name = name.trim();
            if (!name) return;
            apiPost('/api/groups/rename', { gid: GID, name: name }).then(function (j) {
                toast(j.ok ? '已重命名' : (j.error || '操作失败'));
                if (j.ok) loadGroupSelector().then(function () { loadGroup(); });
            });
        });
    }

    function transferGroup() {
        UI.prompt({
            title: '转移群聊',
            text: '输入要转让的新群主用户名（须为该群成员）：',
            placeholder: '新群主用户名',
            okText: '转让',
            input: { type: 'text', placeholder: '新群主用户名', maxLength: 20 }
        }).then(function (name) {
            if (name == null) return;
            name = name.trim();
            if (!name) return;
            UI.confirm({ title: '确认转让', text: '确定将群主转让给「' + name + '」？', okText: '确认转让' })
                .then(function (ok) {
                    if (!ok) return;
                    apiPost('/api/groups/transfer', { gid: GID, name: name }).then(function (j) {
                        toast(j.ok ? '群主已转让给 ' + name : (j.error || '操作失败'));
                        if (j.ok) loadGroupSelector().then(function () { loadGroup(); });
                    });
                });
        });
    }

    function deleteGroup() {
        UI.confirm({
            title: '删除群聊',
            text: '确定解散该群？群内消息与文件将一并删除，且不可恢复。',
            okText: '删除群聊'
        }).then(function (ok) {
            if (!ok) return;
            fetch(api('/api/groups'), {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gid: GID })
            }).then(function (r) { return r.json(); })
            .then(function (j) {
                toast(j.ok ? '群已解散' : (j.error || '操作失败'));
                if (j.ok) {
                    GID = null;
                    persistGid(null);
                    loadGroupSelector().then(function (groups) {
                        if (groups && groups.length) selectGroup(groups[0].id);
                    });
                }
            })
            .catch(function () { toast('操作失败'); });
        });
    }

    // ---------- 初始化 ----------

    function selectGroup(gid) {
        GID = gid;
        $('groupSelect').value = gid;
        loadGroup();
    }

    function persistGid(gid) {
        // 用于刷新后尽量停留在同一群；不强制校验
        try {
            var u = new URL(location.href);
            if (gid) u.searchParams.set('gid', gid); else u.searchParams.delete('gid');
            history.replaceState(null, '', u);
        } catch (e) { /* 忽略 */ }
    }

    function boot() {
        fetch(api('/api/me'), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j.ok) { location.replace('/login.html'); return; }
                ME = j.username;
                IS_ADMIN = j.role === 'admin';

                $('groupSelect').addEventListener('change', function () { selectGroup(this.value); });
                $('groupBack').addEventListener('click', function () { location.href = '/chat.html'; });
                $('themeBtn').addEventListener('click', toggleTheme);
                updateThemeIcon();
                $('logoutBtn').addEventListener('click', function () {
                    fetch(api('/api/logout'), { method: 'POST', credentials: 'same-origin' }).catch(function () {});
                    location.replace('/login.html');
                });
                $('gmgRename').addEventListener('click', renameGroup);
                $('gmgTransfer').addEventListener('click', transferGroup);
                $('gmgDelete').addEventListener('click', deleteGroup);

                return loadGroupSelector();
            })
            .then(function (groups) {
                var initial = new URLSearchParams(location.search).get('gid') || '';
                var target = groups && groups.some(function (g) { return g.id === initial; }) ? initial : null;
                if (!target && groups && groups.length) target = groups[0].id;
                if (target) selectGroup(target);
            })
            .catch(function () { location.replace('/login.html'); });
    }

    document.addEventListener('DOMContentLoaded', boot);
})();