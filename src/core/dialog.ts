/*
 * CircleChat 前端 — 确认 / 输入弹窗（Vue 版，替代旧 public/js/ui.js）
 * 用法（组合式）：
 *   import { confirm, prompt } from '../core/dialog';
 *   const ok = await confirm({ title, text, okText, danger });
 *   const v  = await prompt({ title, text, placeholder, okText, input: {...} });
 * 视图由 components/common/Dialog.vue 渲染（需在根组件挂载一次）。
 */

import { reactive } from 'vue';

export interface DialogInput {
  type?: string;
  placeholder?: string;
  maxLength?: number;
  value?: string;
  /** 必须逐字输入这段文字才允许点确定（危险操作的二次确认） */
  mustEqual?: string;
}

export interface DialogOptions {
  title?: string;
  text?: string;
  /** 顶层 placeholder 仅为兼容旧调用习惯，实际输入框使用 input.placeholder */
  placeholder?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  input?: DialogInput;
}

interface DialogState extends DialogOptions {
  open: boolean;
  /** 每次打开自增：同一时间重复打开时用来触发视图重置输入框 */
  token: number;
  resolve: ((value: string | boolean | null) => void) | null;
}

export const dialogState = reactive<DialogState>({
  open: false,
  token: 0,
  title: '',
  text: '',
  okText: '',
  cancelText: '',
  danger: true,
  input: undefined,
  resolve: null
});

function open(opts: DialogOptions): Promise<string | boolean | null> {
  // 上一个弹窗还没结算（连点按钮）→ 先按取消结算，避免旧 Promise 永久挂起
  if (dialogState.resolve) {
    const prev = dialogState.resolve;
    dialogState.resolve = null;
    prev(null);
  }
  return new Promise((resolve) => {
    dialogState.open = true;
    dialogState.token++;
    dialogState.title = opts.title || '';
    dialogState.text = opts.text || '';
    dialogState.okText = opts.okText || '';
    dialogState.cancelText = opts.cancelText || '';
    dialogState.danger = opts.danger !== false;
    dialogState.input = opts.input;
    dialogState.resolve = resolve;
  });
}

/** 确认框：返回 boolean（点确定 true，取消/遮罩/Esc null → false） */
export function confirm(opts: DialogOptions): Promise<boolean> {
  return open(opts).then((r) => r === true);
}

/** 输入框：返回字符串（取消 → null） */
export function prompt(opts: Omit<DialogOptions, 'input'> & { input?: DialogInput }): Promise<string | null> {
  return open({ ...opts, input: opts.input || { type: 'text' } }).then((r) =>
    typeof r === 'string' ? r : null
  );
}

/** 由 Dialog.vue 在用户点击时调用 */
export function resolveDialog(value: string | boolean | null): void {
  if (!dialogState.resolve) return;
  const fn = dialogState.resolve;
  dialogState.resolve = null;
  dialogState.open = false;
  fn(value);
}
