/* ============================================================
 * 长按手势（移动端）
 * - 基于 Pointer Events，按住 delay 毫秒触发；
 * - 手指移动超过容差、页面滚动、或指针取消都会撤销，避免误触；
 * - 触发后会吞掉紧随其后的 click：否则「菜单刚打开就被全局 click 监听关掉」，
 *   或者长按与点击各自弹一次菜单。
 * 桌面端不介入（右键菜单由 @contextmenu 处理）。
 * ============================================================ */
import { onBeforeUnmount, watch } from 'vue';
import type { Ref } from 'vue';

export interface LongPressOptions {
  /** 触发时长（ms），默认 500 */
  delay?: number;
  /** 允许的位移（px），超过即取消，默认 10 */
  moveTolerance?: number;
  onLongPress: (x: number, y: number) => void;
  /** 触发后是否吞掉紧随的 click（默认 true） */
  swallowClick?: boolean;
}

export function useLongPress(el: Ref<HTMLElement | null>, opts: LongPressOptions): void {
  const delay = opts.delay ?? 500;
  const tol = opts.moveTolerance ?? 10;
  const swallow = opts.swallowClick !== false;

  let timer: number | undefined;
  let armed = false;
  let sx = 0;
  let sy = 0;
  let bound: HTMLElement | null = null;

  function cancel(): void {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    armed = false;
  }

  function swallowNextClick(): void {
    window.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        e.preventDefault();
      },
      { capture: true, once: true }
    );
  }

  function onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return; // 桌面走右键菜单，互不干扰
    cancel();
    sx = e.clientX;
    sy = e.clientY;
    armed = true;
    const x = e.clientX;
    const y = e.clientY;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (!armed) return;
      armed = false;
      if (swallow) swallowNextClick();
      // 移动端长按默认会选中文字，清掉选区，体验更像原生
      try {
        window.getSelection()?.removeAllRanges();
      } catch {
        /* 忽略 */
      }
      opts.onLongPress(x, y);
    }, delay);
  }

  function onMove(e: PointerEvent): void {
    if (!armed) return;
    if (Math.abs(e.clientX - sx) > tol || Math.abs(e.clientY - sy) > tol) cancel();
  }

  function bind(target: HTMLElement | null): void {
    if (bound === target) return;
    if (bound) {
      bound.removeEventListener('pointerdown', onDown);
      bound.removeEventListener('pointermove', onMove);
      bound.removeEventListener('pointerup', cancel);
      bound.removeEventListener('pointercancel', cancel);
      bound.removeEventListener('pointerleave', cancel);
    }
    bound = target;
    if (target) {
      target.addEventListener('pointerdown', onDown);
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', cancel);
      target.addEventListener('pointercancel', cancel);
      target.addEventListener('pointerleave', cancel);
    }
  }

  watch(el, (v) => bind(v), { immediate: true });

  window.addEventListener('scroll', cancel, { capture: true, passive: true });
  onBeforeUnmount(() => {
    cancel();
    bind(null);
    window.removeEventListener('scroll', cancel, { capture: true });
  });
}
