/* ============================================================
 * ChatPlus 私人聊天 — 聊天页逻辑
 * 版权 © 2026 Ctoy，保留所有权利。禁止去除版权信息。
 * ============================================================ */

(function () {
    'use strict';

    var CFG = window.CHAT_CONFIG || {};
    var ME = null;          // 当前登录用户名
    var ws = null;
    var reconnectDelay = 1000;
    var reconnectTimer = null;
    var heartbeatTimer = null;
    var onlineUsers = [];   // 在线用户列表
    var allUsers = [];      // 全部账号列表
    var userImages = {};    // 用户名 -> 头像图片地址（来自用户配置，未配置则为 null）
    var notifyOn = false;   // 系统通知开关
    var connectedOnce = false; // 是否曾成功建立 WS 连接（用于判断会话是否过期）

    // ---------- 地址解析（请求地址 / 展示地址分离） ----------

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
    function wsUrl() {
        var base = apiBase();
        var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
        if (/^https?:\/\//i.test(base)) {
            var u = new URL(base);
            return (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + u.pathname.replace(/\/+$/, '') + '/ws';
        }
        return proto + location.host + base + '/ws';
    }

    // ---------- DOM 快捷方式 ----------

    function $(id) { return document.getElementById(id); }
    var msgList = $('msgList');
    var textInput = $('textInput');
    var connDot = $('connDot');
    var chatTitle = $('chatTitle');
    var sidebarUsers = $('sidebarUsers');
    var sidebarMe = $('sidebarMe');
    var chatView = $('chatView');
    var toastEl = $('toast');

    // ---------- 主题（深色模式） ----------
    function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); }
    function currentTheme() {
      var s;
      try { s = localStorage.getItem('chatplus_theme'); } catch (e) { s = null; }
      if (s === 'dark' || s === 'light') return s;
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    function isMobile() { return window.matchMedia && window.matchMedia('(max-width: 767px)').matches; }
    var ICON_MOON = '<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.33-9.62A9.05 9.05 0 0 0 12 3z"></path>';
    var ICON_SUN = '<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm-9-3H1v2h2v-2zm20 0h-2v2h2v-2zM6.34 6.34 4.93 4.93l1.41-1.41 1.41 1.41L6.34 6.34zm12.02 12.02-1.41 1.41 1.41 1.41 1.41-1.41-1.41-1.41zM4.93 19.07l1.41-1.41 1.41 1.41-1.41 1.41-1.41-1.41zm12.02-12.02 1.41-1.41 1.41 1.41-1.41 1.41-1.41-1.41z"></path>';
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
    // 尽早应用主题，避免页面闪烁
    applyTheme(currentTheme());

    // ---------- 工具 ----------

    function toast(msg, ms) {
        toastEl.textContent = msg;
        toastEl.classList.remove('hidden');
        clearTimeout(toastEl._t);
        toastEl._t = setTimeout(function () { toastEl.classList.add('hidden'); }, ms || 2500);
    }

    function fmtSize(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function fmtTime(ts) {
        var d = new Date(ts);
        var h = d.getHours().toString().padStart(2, '0');
        var m = d.getMinutes().toString().padStart(2, '0');
        return h + ':' + m;
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function scrollToBottom() {
        msgList.scrollTop = msgList.scrollHeight;
    }

    // ---------- 头像（确定性配色首字母头像，前端生成，无需改服务端） ----------
    var AVATAR_PALETTE = ['#07c160', '#ff9f0a', '#ff375f', '#5856d6', '#0a84ff',
                          '#bf5af2', '#ff6482', '#30d158', '#64d2ff', '#ffd60a',
                          '#5e5ce6', '#e56a4d'];
    function avatarColor(name) {
        var h = 0;
        name = String(name || '?');
        for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
    }
    function makeAvatar(name, cls) {
        var d = document.createElement('div');
        d.className = cls;
        d.setAttribute('aria-hidden', 'true');
        d.textContent = (String(name || '?').charAt(0) || '?').toUpperCase();
        d.style.background = avatarColor(name);
        return d;
    }
    // 优先使用用户配置的头像图片，未配置则回退为字母头像
    function makeAvatarEl(name, cls) {
        var img = userImages[String(name)];
        if (img) {
            var el = document.createElement('img');
            el.className = cls + ' av-img';
            el.src = img;
            el.alt = String(name);
            el.setAttribute('aria-hidden', 'true');
            return el;
        }
        return makeAvatar(name, cls);
    }

    // ---------- 账号列表（在线状态展示） ----------

    function loadUsers() {
        fetch(api('/api/users'), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j.ok) {
                    allUsers = [];
                    userImages = {};
                    (j.users || []).forEach(function (u) {
                        if (typeof u === 'string') {
                            allUsers.push(u);
                        } else {
                            allUsers.push(u.name);
                            userImages[u.name] = u.image || null; // 手动配置的头像地址
                        }
                    });
                    renderUsers();
                }
            })
            .catch(function () { /* 忽略 */ });
    }

    // ---------- Windows 系统通知 ----------

    function setNotifyUI() {
        var t = $('notifyToggle');
        if (t) t.checked = !!notifyOn;
    }

    function loadSettings() {
        fetch(api('/api/settings'), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j.ok) {
                    notifyOn = j.settings.notify !== false; // 未设置过则默认开启
                    setNotifyUI();
                }
            })
            .catch(function () { /* 忽略 */ });
    }

    function saveSettings() {
        fetch(api('/api/settings'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ notify: notifyOn })
        }).catch(function () { /* 忽略 */ });
    }

    function turnOffNotify() {
        notifyOn = false;
        setNotifyUI();
        saveSettings();
    }

    function turnOnNotify() {
        if (!('Notification' in window)) {
            toast('当前浏览器不支持系统通知（需 HTTPS 或 localhost 访问）');
            setNotifyUI();
            return;
        }
        if (Notification.permission === 'denied') {
            toast('浏览器已拒绝通知，请在浏览器设置中允许后重试');
            setNotifyUI();
            return;
        }
        if (Notification.permission === 'default') {
            Notification.requestPermission().then(function (p) {
                if (p !== 'granted') {
                    toast('未获得通知权限，通知无法弹出');
                    notifyOn = false;
                    setNotifyUI();
                    return;
                }
                notifyOn = true;
                setNotifyUI();
                saveSettings();
                toast('系统通知已开启');
            });
            return;
        }
        notifyOn = true;
        setNotifyUI();
        saveSettings();
        toast('系统通知已开启');
    }

    function showNotify(m) {
        if (!notifyOn || !document.hidden || m.from === ME) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        var body = m.type === 'text'
            ? String(m.content)
            : (m.type === 'image' ? '[图片] ' : '[文件] ') + String(m.name || '');
        try {
            var n = new Notification(m.from + ' 发来消息', { body: body.slice(0, 120), tag: 'chatplus' });
            n.onclick = function () { window.focus(); n.close(); };
        } catch (e) { /* 忽略 */ }
    }

    // ---------- 渲染消息 ----------

    // 防注入：仅允许本服务器上传目录的合法资源 URL
    function safeUploadUrl(content) {
        if (/^\/uploads\/[a-zA-Z0-9]+\.[a-z0-9]{2,5}$/i.test(String(content || ''))) {
            return api(String(content));
        }
        return null;
    }

    function renderMsg(m) {
        var wrap = document.createElement('div');
        wrap.className = 'msg ' + (m.from === ME ? 'self' : 'other');

        var body = document.createElement('div');
        body.className = 'msg-body';

        var bubble = document.createElement('div');
        bubble.className = 'bubble';

        if (m.type === 'image') {
            var src = safeUploadUrl(m.content);
            if (!src) return;
            var img = document.createElement('img');
            img.src = src;
            img.alt = m.name || '图片';
            img.loading = 'lazy';
            img.addEventListener('click', function () {
                var w = window.open('', '_blank');
                if (w) { w.document.write('<html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center"><img src="' + src + '" style="max-width:100vw;max-height:100vh"></body></html>'); w.document.close(); }
            });
            bubble.appendChild(img);
        } else if (m.type === 'file') {
            var href = safeUploadUrl(m.content);
            if (!href) return;
            var a = document.createElement('a');
            a.className = 'file-card';
            a.href = href;
            a.download = m.name || 'file';
            a.innerHTML = '<span style="font-size:20px">📄</span><span><span class="fname">' + esc(m.name || '文件') + '</span><br><span class="fsize">' + fmtSize(m.size) + ' · 点击下载</span></span>';
            bubble.appendChild(a);
        } else {
            bubble.textContent = m.content;
        }

        var meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = (m.from === ME ? '' : m.from + ' · ') + fmtTime(m.ts);

        body.appendChild(meta);
        body.appendChild(bubble);

        var avatar = makeAvatarEl(m.from, 'msg-avatar');

        wrap.appendChild(avatar);
        wrap.appendChild(body);

        msgList.appendChild(wrap);
        scrollToBottom();
    }

    function renderHistory(list) {
        msgList.innerHTML = '';
        if (!list || !list.length) {
            var empty = document.createElement('div');
            empty.className = 'sys-msg';
            empty.textContent = '暂无消息，说点什么吧～';
            msgList.appendChild(empty);
        } else {
            var tip = document.createElement('div');
            tip.className = 'sys-msg';
            tip.textContent = '— 仅保留最近 500 条消息 —';
            msgList.appendChild(tip);
            list.forEach(renderMsg);
        }
        scrollToBottom();
    }

    // ---------- 在线用户（侧边栏） ----------

    function renderUsers() {
      if (!sidebarUsers) return;
      sidebarUsers.innerHTML = '';
      if (!allUsers.length) {
        var tip = document.createElement('div');
        tip.className = 'sidebar-section-title';
        tip.textContent = '连接中…';
        sidebarUsers.appendChild(tip);
        return;
      }
      var head = document.createElement('div');
      head.className = 'sidebar-section-title';
      head.textContent = '成员 · ' + allUsers.length;
      sidebarUsers.appendChild(head);

      allUsers.forEach(function (n) {
        var on = onlineUsers.indexOf(n) !== -1;
        var self = n === ME;
        var item = document.createElement('div');
        item.className = 'user-item' + (self ? ' me' : '') + (on || self ? ' online' : ' offline');

        var avatar = makeAvatarEl(n, 'user-avatar');
        // 离线用户：字母头像清空内联样式，使用 CSS 的灰色样式（图片头像由 CSS 置灰）
        if (!on && !self && avatar.tagName !== 'IMG') {
            avatar.style.background = '';
            avatar.style.color = '';
        }

        var meta = document.createElement('div');
        meta.className = 'user-meta';
        var name = document.createElement('div');
        name.className = 'user-name';
        name.textContent = n + (self ? '（我）' : '');
        var status = document.createElement('div');
        status.className = 'user-status';
        status.textContent = (on || self) ? '在线' : '离线';
        meta.appendChild(name);
        meta.appendChild(status);

        var dot = document.createElement('div');
        dot.className = 'user-dot';

        item.appendChild(avatar);
        item.appendChild(meta);
        item.appendChild(dot);
        sidebarUsers.appendChild(item);
      });
    }

    // ---------- WebSocket ----------

    function setConn(state) {
        connDot.className = 'dot ' + state;
        connDot.title = state === 'on' ? '已连接' : (state === 'off' ? '已断开' : '连接中…');
    }

    function sendWs(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj));
            return true;
        }
        toast('连接未就绪，请稍候');
        return false;
    }

    function connectWs() {
        setConn('conn');
        var sock;
        try { sock = new WebSocket(wsUrl()); } catch (e) { scheduleReconnect(); return; }
        ws = sock;

        sock.onopen = function () {
            connectedOnce = true;
            setConn('on');
            reconnectDelay = 1000;
            clearInterval(heartbeatTimer);
            heartbeatTimer = setInterval(function () {
                if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
            }, 30000);
            loadHistory();
        };

        sock.onmessage = function (ev) {
            var obj;
            try { obj = JSON.parse(ev.data); } catch (e) { return; }
            if (!obj || typeof obj !== 'object') return;
            if (obj.type === 'msg') { renderMsg(obj.data); showNotify(obj.data); }
            else if (obj.type === 'presence') {
                onlineUsers = obj.users || [];
                renderUsers();
            }
        };

        sock.onclose = function () {
            setConn('off');
            clearInterval(heartbeatTimer);
            if (ws !== sock) return;
            // 从未成功连接过（多半是会话已过期）：校验登录态，失效则跳登录页
            if (!connectedOnce) {
              fetch(api('/api/me'), { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                  if (!j.ok) location.replace('/login.html');
                  else scheduleReconnect();
                })
                .catch(function () { scheduleReconnect(); });
            } else {
              scheduleReconnect();
            }
        };
        sock.onerror = function () { try { sock.close(); } catch (e) { /* 忽略 */ } };
    }

    function scheduleReconnect() {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(function () {
            connectWs();
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        }, reconnectDelay);
    }

    // ---------- 历史消息 ----------

    function loadHistory() {
        fetch(api('/api/messages'), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j.ok) renderHistory(j.messages);
            })
            .catch(function () { /* 忽略，重连后会重试 */ });
    }

    // ---------- 发送 ----------

    function sendText() {
        var val = textInput.value.trim();
        if (!val) return;
        if (!sendWs({ type: 'msg', data: { type: 'text', content: val } })) return;
        textInput.value = '';
        textInput.focus();
    }

    function uploadFile(file, kindLabel) {
        var fd = new FormData();
        fd.append('file', file);
        toast('正在上传 ' + kindLabel + '…');
        var ctrl = window.AbortController ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 60000) : null;
        fetch(api('/api/upload'), { method: 'POST', body: fd, credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined })
            .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
            .then(function (res) {
                if (!res.body.ok) { toast(res.body.error || '上传失败'); return; }
                var b = res.body;
                sendWs({
                    type: 'msg',
                    data: { type: b.kind, content: b.url, name: b.name, size: b.size }
                });
            })
            .catch(function () { toast('上传失败或超时，请重试'); })
            .then(function () { if (timer) clearTimeout(timer); });
    }

    // ---------- 表情 ----------

    var EMOJIS = [
        // 原有表情
        '😀', '😁', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😜', '🤪', '😎', '🤩', '🥳', '😏', '😢', '😭', '😡', '🤬', '😱', '😨', '🤔', '🤗', '🤭', '🤫', '😴', '🤤', '😷', '🤒', '👍', '👎', '👌', '✌️', '🤞', '🤙', '👏', '🙏', '💪', '🤝', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💯', '✨', '🔥', '🎉', '🎊', '🎈', '⚡', '🌈', '☀️', '🌙', '☕', '🍵', '🍺', '🎵', '🎮', '🚀', '🐱', '🐶', '🐼', '🌹', '🍀', '⏰', '📌',

        // 补充：更多表情脸
        '😃', '😄', '😆', '😅', '😋', '😛', '😝', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😤', '😠', '😲', '😮', '😯', '😳', '😬', '😰', '😥', '😓', '🤯', '😵', '😵‍💫', '🥱', '😪', '🤢', '🤮', '🤧', '🤠', '👻', '💀', '☠️', '👽', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '🙈', '🙉', '🙊',

        // 补充：手势 & 身体
        '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤟', '🤘', '👈', '👉', '👆', '👇', '☝️', '✊', '👊', '🤛', '🤜', '👋', '🤚', '🖐️', '💅', '🤳', '💋', '🫂', '👣', '👀', '👁️', '👂', '👃', '👄', '🦷', '🦴', '👓', '🕶️', '👔', '👕', '👖', '👗', '👠', '👑', '🎩', '🧢', '💍', '💎',

        // 补充：心 & 情感
        '🤍', '🤎', '💗', '💓', '💕', '💖', '💝', '💞', '💟', '❣️', '💔', '❤️‍🔥', '❤️‍🩹', '💋', '💌', '💐', '🌸', '🌺', '🌻', '🌷', '🌼', '🪷', '🌵', '🎋', '🍂', '🍁', '🌊', '💧', '☔', '❄️', '⛄', '🌸', '🌺',

        // 补充：食物 & 饮料
        '🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍑', '🍒', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🥦', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐', '🍞', '🥖', '🧀', '🍗', '🍖', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥗', '🥘', '🍝', '🍜', '🍲', '🍣', '🍱', '🥟', '🍤', '☕', '🍵', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧃', '🥤', '🧊', '🫗',

        // 补充：动物
        '🐭', '🐹', '🐰', '🦊', '🐻', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🦂', '🐙', '🦑', '🦐', '🦞', '🐠', '🐟', '🐡', '🦈', '🐳', '🐬', '🐊', '🐢', '🐍', '🦎', '🐲', '🌵', '🌲', '🌳', '🌴', '🌱', '🌿', '☘️', '🍄', '🌾', '🌍', '🌎', '🌏', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '⭐', '🌟', '💫', '☄️', '☀️', '🌤️', '⛅', '🌥️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '💦', '☔', '🌈', '🌊',

        // 补充：物品 & 工具
        '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '📷', '📸', '📹', '🎥', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '⏱️', '⏲️', '⏰', '🕰️', '⌚', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '💰', '💳', '💎', '⚖️', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '⚙️', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚪', '🪑', '🛏️', '🛋️', '🚽', '🚿', '🛁', '🧴', '🧷', '🧹', '🧺', '🧻', '🧼', '🧽', '🧯', '🛒', '🚬', '⚰️', '⚱️', '🗿', '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '💒', '🗼', '🗽', '⛪', '🕌', '🕍', '⛩️', '🕋', '🌁', '🌃', '🌄', '🌅', '🌆', '🌇', '🌉', '🌌', '🎠', '🎡', '🎢', '🎪', '🚂', '🚃', '🚄', '🚅', '🚆', '🚇', '🚈', '🚉', '🚊', '🚝', '🚞', '🚋', '🚌', '🚍', '🚎', '🚐', '🚑', '🚒', '🚓', '🚔', '🚕', '🚖', '🚗', '🚘', '🚙', '🚚', '🚛', '🚜', '🚝', '🚞', '🚟', '🚠', '🚡', '🚢', '⛴️', '🛳️', '🚀', '🛸', '🛰️', '🚁', '🚂', '🚃', '🚄', '🚅', '🚆', '🚇', '🚈', '🚉', '🚊', '🚝', '🚞', '🚋', '🚌', '🚍', '🚎', '🚐', '🚑', '🚒', '🚓', '🚔', '🚕', '🚖', '🚗', '🚘', '🚙', '🚚', '🚛', '🚜',

        // 补充：符号 & 其他
        '❗', '❓', '✅', '❌', '⭕', '❌', '🚫', '⛔', '🚷', '🚯', '🚳', '🚱', '🔞', '📛', '⚠️', '🚸', '🔰', '♻️', '✳️', '❇️', '✴️', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻', '💠', '🔘', '🔳', '🔲', '🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏴‍☠️', '🇦🇫', '🇦🇱', '🇩🇿', '🇦🇸', '🇦🇩', '🇦🇴', '🇦🇮', '🇦🇶', '🇦🇬', '🇦🇷', '🇦🇲', '🇦🇼', '🇦🇺', '🇦🇹', '🇦🇿', '🇧🇸', '🇧🇭', '🇧🇩', '🇧🇧', '🇧🇾', '🇧🇪', '🇧🇿', '🇧🇯', '🇧🇲', '🇧🇹', '🇧🇴', '🇧🇦', '🇧🇼', '🇧🇷', '🇧🇳', '🇧🇬', '🇧🇫', '🇧🇮', '🇰🇭', '🇨🇲', '🇨🇦', '🇮🇨', '🇨🇻', '🇧🇶', '🇰🇾', '🇨🇫', '🇹🇩', '🇨🇱', '🇨🇴', '🇰🇲', '🇨🇩', '🇨🇬', '🇨🇰', '🇨🇷', '🇭🇷', '🇨🇺', '🇨🇼', '🇨🇾', '🇨🇿', '🇩🇰', '🇩🇯', '🇩🇲', '🇩🇴', '🇪🇨', '🇪🇬', '🇸🇻', '🇬🇶', '🇪🇷', '🇪🇪', '🇪🇹', '🇪🇺', '🇫🇰', '🇫🇴', '🇫🇯', '🇫🇮', '🇫🇷', '🇬🇫', '🇵🇫', '🇹🇫', '🇬🇦', '🇬🇲', '🇬🇪', '🇩🇪', '🇬🇭', '🇬🇮', '🇬🇷', '🇬🇱', '🇬🇩', '🇬🇵', '🇬🇺', '🇬🇹', '🇬🇬', '🇬🇳', '🇬🇼', '🇬🇾', '🇭🇹', '🇭🇳', '🇭🇰', '🇭🇺', '🇮🇸', '🇮🇳', '🇮🇩', '🇮🇷', '🇮🇶', '🇮🇪', '🇮🇲', '🇮🇱', '🇮🇹', '🇨🇮', '🇯🇲', '🇯🇵', '🇯🇪', '🇯🇴', '🇰🇿', '🇰🇪', '🇰🇮', '🇽🇰', '🇰🇼', '🇰🇬', '🇱🇯', '🇱🇵', '🇱🇦', '🇱🇭', '🇹🇷', '🇨🇳', '🇺🇸', '🇬🇧', '🇷🇺', '🇰🇷', '🇷🇴', '🇲🇽', '🇪🇸', '🇵🇹', '🇳🇱', '🇸🇪', '🇳🇴', '🇵🇱', '🇺🇦', '🇿🇦', '🇯🇵', '🇰🇷', '🇸🇬', '🇲🇾', '🇵🇭', '🇻🇳', '🇮🇩', '🇹🇭', '🇦🇪', '🇸🇦', '🇶🇦', '🇰🇼', '🇧🇭', '🇴🇲', '🇯🇴', '🇱🇴', '🇲🇨', '🇲🇻', '🇱🇰', '🇱🇱', '🇹🇲', '🇺🇿', '🇰🇬', '🇹🇦', '🇹🇻', '🇹🇿', '🇺🇬', '🇺🇦', '🇦🇪', '🇬🇧', '🇺🇸', '🇺🇾', '🇺🇿', '🇻🇺', '🇻🇦', '🇻🇪', '🇻🇳', '🇾🇪', '🇿🇲', '🇿🇼'
    ];
    function buildEmojiPanel() {
        var panel = $('emojiPanel');
        panel.innerHTML = '';
        EMOJIS.forEach(function (e) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = e;
            b.addEventListener('click', function () {
                textInput.value += e;
                textInput.focus();
                panel.classList.add('hidden');
            });
            panel.appendChild(b);
        });
    }

    // ---------- 登出 ----------

    function doLogout() {
        fetch(api('/api/logout'), { method: 'POST', credentials: 'same-origin' })
            .catch(function () { /* 忽略 */ });
        if (ws) { try { ws.close(); } catch (e) { /* 忽略 */ } }
        ws = null;
        clearInterval(heartbeatTimer);
        clearTimeout(reconnectTimer);
        ME = null;
        onlineUsers = [];
        allUsers = [];
        setConn('off');
        location.replace('/login.html');
    }

    // ---------- 初始化（已确认登录后调用） ----------

    function startChat() {
      buildEmojiPanel();

      if (sidebarMe) sidebarMe.textContent = ME;

      // 侧边栏：桌面端折叠 / 移动端展开-收起
      $('sidebarToggle').addEventListener('click', function () {
        chatView.classList.add('sidebar-open');
      });
      $('sidebarCollapse').addEventListener('click', function () {
        if (isMobile()) chatView.classList.remove('sidebar-open');
        else chatView.classList.toggle('sidebar-collapsed');
      });
      $('sidebarBackdrop').addEventListener('click', function () {
        chatView.classList.remove('sidebar-open');
      });
      // 视口放大到桌面端时，清除移动端抽屉状态，避免侧边栏被错误隐藏
      window.addEventListener('resize', function () {
        if (!isMobile()) chatView.classList.remove('sidebar-open');
      });

      // 深色模式
      $('themeBtn').addEventListener('click', toggleTheme);
      updateThemeIcon();

      $('logoutBtn').addEventListener('click', doLogout);
      $('notifyToggle').addEventListener('change', function () {
        if (this.checked) turnOnNotify(); else turnOffNotify();
      });
      $('sendBtn').addEventListener('click', sendText);
      textInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
      });

      $('emojiBtn').addEventListener('click', function () {
        $('emojiPanel').classList.toggle('hidden');
      });

      $('imageBtn').addEventListener('click', function () {
        var f = $('fileInput');
        f.accept = 'image/png,image/jpeg,image/gif,image/webp';
        f.value = '';
        f.click();
      });

      $('fileBtn').addEventListener('click', function () {
        var f = $('fileInput');
        f.accept = '';
        f.value = '';
        f.click();
      });

      $('fileInput').addEventListener('change', function () {
        var file = this.files && this.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) { toast('文件超过 20MB 上限'); return; }
        var isImg = /^image\/(png|jpeg|gif|webp)$/.test(file.type);
        uploadFile(file, isImg ? '图片' : '文件');
        this.value = '';
      });

      textInput.focus();
      loadUsers();
      loadSettings();
      connectWs();
    }

    // ---------- 鉴权守卫：未登录直接跳登录页 ----------

    function checkAuth() {
        fetch(api('/api/me'), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j.ok) {
                  ME = j.username;
                  onlineUsers = j.online || [];
                  chatTitle.textContent = 'ChatPlus · ' + ME;
                  renderUsers();
                  startChat();
                } else {
                  location.replace('/login.html');
                }
                })
                .catch(function () { location.replace('/login.html'); });
    }

    document.addEventListener('DOMContentLoaded', checkAuth);
})();
