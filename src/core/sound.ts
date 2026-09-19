/* ============================================================
 * CircleChat 前端 — 音效
 * 收到他人新消息 / 自己发送消息时的提示音。
 * 音效来源：Pixabay（作者 universfield），许可见 CREDITS.md。
 *
 * 说明：
 * - 音频元素在模块加载时即创建并预加载，避免首次播放时媒体尚未就绪。
 * - 设置 currentTime 与 play() 分别用 try 包裹：前者在媒体未就绪时可能抛错，
 *   绝不能让它阻断后面的 play()。
 * - 受浏览器自动播放策略限制，用户首次交互前 play() 会被拒绝，此处静默忽略。
 * ============================================================ */

import { url } from './api';

const hasAudio = typeof Audio !== 'undefined';

function make(src: string, volume: number): HTMLAudioElement | null {
  if (!hasAudio) return null;
  const a = new Audio(src);
  a.preload = 'auto';
  a.volume = volume;
  return a;
}

const incoming = make(url('/audio/universfield-new-notification-08-352461.mp3'), 0.6);
const outgoing = make(url('/audio/universfield-message-ping-351298.mp3'), 0.5);

function play(a: HTMLAudioElement | null): void {
  if (!a) return;
  try {
    a.currentTime = 0; // 媒体未就绪时可能抛错，忽略后继续尝试播放
  } catch {
    /* 忽略 */
  }
  try {
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* 未获得用户手势前会被拒绝，忽略 */ });
  } catch {
    /* 忽略 */
  }
}

/** 收到他人新消息 */
export function playIncoming(): void {
  play(incoming);
}

/** 自己发送消息（文本 / 文件） */
export function playOutgoing(): void {
  play(outgoing);
}
