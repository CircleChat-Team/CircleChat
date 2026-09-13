'use strict';
/* ============================================================
 * CircleChat 私人聊天 — 通用 UI 组件（自定义确认 / 输入弹窗）
 *
 * 替代原生 window.confirm / window.prompt：原生弹窗样式无法定制、
 * 在移动端表现生硬，且会阻塞页面。DOM 由本文件动态创建，页面无需加标签。
 *
 * 用法：
 *   UI.confirm({ title, text, okText, danger }) -> Promise<boolean>
 *   UI.prompt({ title, text, placeholder, okText, maxLength }) -> Promise<string|null>
 * ============================================================ */

(function () {
    var mask = null, titleEl, textEl, inputEl, okBtn, cancelBtn;
    var resolveFn = null;

    // 首次使用时才创建并插入 DOM
    function build() {
        if (mask) return;

        mask = document.createElement('div');
        mask.className = 'confirm-mask hidden';

        var card = document.createElement('div');
        card.className = 'confirm-card';

        titleEl = document.createElement('div');
        titleEl.className = 'confirm-title';

        textEl = document.createElement('div');
        textEl.className = 'confirm-text';

        inputEl = document.createElement('input');
        inputEl.className = 'confirm-input hidden';
        inputEl.type = 'text';

        var actions = document.createElement('div');
        actions.className = 'confirm-actions';

        cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'confirm-btn';
        cancelBtn.textContent = '取消';

        okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'confirm-btn danger';

        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        card.appendChild(titleEl);
        card.appendChild(textEl);
        card.appendChild(inputEl);
        card.appendChild(actions);
        mask.appendChild(card);
        document.body.appendChild(mask);

        cancelBtn.addEventListener('click', function () { close(null); });
        okBtn.addEventListener('click', submit);
        mask.addEventListener('click', function (e) { if (e.target === mask) close(null); });
        inputEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
        // 捕获阶段处理 Esc，优先于页面上的其它 Esc 逻辑
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (!mask || mask.classList.contains('hidden')) return;
            e.stopPropagation();
            close(null);
        }, true);
    }

    function submit() {
        if (inputEl && !inputEl.classList.contains('hidden')) {
            if (!inputEl.value) { inputEl.focus(); return; }
            close(inputEl.value);
            return;
        }
        close(true);
    }

    function close(result) {
        if (!mask) return;
        mask.classList.add('hidden');
        var fn = resolveFn;
        resolveFn = null;
        if (fn) fn(result);
    }

    function open(opt) {
        build();
        var o = opt || {};
        var withInput = !!o.input;

        titleEl.textContent = o.title || '确认操作';
        textEl.textContent = o.text || '';
        textEl.classList.toggle('hidden', !o.text);

        inputEl.classList.toggle('hidden', !withInput);
        if (withInput) {
            inputEl.value = '';
            inputEl.type = o.input.type || 'text';
            inputEl.placeholder = o.input.placeholder || '';
            inputEl.maxLength = o.input.maxLength || 64;
            inputEl.autocomplete = 'off';
        }

        okBtn.textContent = o.okText || '确定';
        // danger 默认为 true（危险操作红色按钮），显式传 false 时用主色
        okBtn.className = 'confirm-btn ' + (o.danger === false ? 'primary' : 'danger');

        mask.classList.remove('hidden');
        setTimeout(function () {
            if (withInput) inputEl.focus();
            else okBtn.focus();
        }, 60);

        return new Promise(function (resolve) { resolveFn = resolve; });
    }

    window.UI = {
        confirm: function (opt) {
            return open(opt).then(function (r) { return r === true; });
        },
        prompt: function (opt) {
            var o = opt || {};
            o.input = o.input || { type: 'password' };
            return open(o);
        }
    };
})();
