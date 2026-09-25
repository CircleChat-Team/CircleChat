/* ============================================================
 * 弹层通用行为：Esc 关闭 + 打开时聚焦 + 关闭时归还焦点 + 锁背景滚动
 * 以前只有右键菜单/语言菜单/确认框处理了 Esc，图片灯箱、转发、合并转发、
 * 个人资料、外观设置、找朋友、建群等大弹层都关不掉，这里统一补齐。
 * ============================================================ */
import { nextTick, onBeforeUnmount, watch } from 'vue';

export interface OverlayOptions {
  isOpen: () => boolean;
  /** 请求关闭（Esc / 归还焦点时调用） */
  onClose: () => void;
  /** 打开时把焦点移入的容器（可选） */
  container?: () => HTMLElement | null;
  /** 是否锁定背景滚动（默认 true） */
  lockScroll?: boolean;
}

const FOCUSABLE = 'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])';

// 多个弹层可能同时存在（例如确认框叠在弹层上），用计数避免提前解锁
let lockCount = 0;
let savedOverflow = '';

export function useOverlay(opts: OverlayOptions): void {
  const lock = opts.lockScroll !== false;
  let prevFocus: HTMLElement | null = null;

  function onKey(e: KeyboardEvent): void {
    if (!opts.isOpen()) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      opts.onClose();
    }
  }

  function lockBg(): void {
    if (!lock) return;
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount++;
  }

  function unlockBg(): void {
    if (!lock) return;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) document.body.style.overflow = savedOverflow;
  }

  watch(
    () => opts.isOpen(),
    (open) => {
      if (open) {
        prevFocus = document.activeElement as HTMLElement | null;
        lockBg();
        nextTick(() => {
          const el = opts.container ? opts.container() : null;
          const target = el ? el.querySelector<HTMLElement>(FOCUSABLE) || el : null;
          if (target) target.focus({ preventScroll: true });
        });
      } else {
        unlockBg();
        if (prevFocus && document.contains(prevFocus)) {
          prevFocus.focus({ preventScroll: true });
        }
        prevFocus = null;
      }
    },
    { immediate: true }
  );

  document.addEventListener('keydown', onKey);
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKey);
    if (opts.isOpen()) unlockBg();
  });
}
