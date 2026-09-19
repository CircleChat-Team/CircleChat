/* ============================================================
 * CircleChat 前端 — 音效
 * 收到他人新消息 / 自己发送消息时的提示音。
 * 说明：浏览器自动播放策略要求先有用户手势，未交互前 play() 会被拒绝，
 *       这里静默忽略；音频元素按需惰性创建。
 * 音效来源：Pixabay（作者 universfield），许可见 CREDITS.md。
 * ============================================================ */

import { url } from './api';

/** 音效资源地址（走 url() 以兼容 apiBase 子路径 / 跨域部署） */
const SRC = {
  incoming: url('/audio/universfield-new-notification-08-352461.mp3'),
  outgoing: url('/audio/universfield-message-ping-351298.mp3')
};

let incoming: HTMLAudioElement | null = null;
let outgoing: HTMLAudioElement | null = null;

function make(src: string, volume: number): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  const a = new Audio(src);
  a.preload = 'auto';
  a.volume = volume;
  return a;
}

function play(a: HTMLAudioElement | null): void {
  if (!a) return;
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* 未获得用户手势前会被拒绝，忽略 */ });
  } catch {
    /* 忽略 */
  }
}

/** 收到他人新消息 */
export function playIncoming(): void {
  if (!incoming) incoming = make(SRC.incoming, 0.6);
  play(incoming);
}

/** 自己发送消息（文本 / 文件） */
export function playOutgoing(): void {
  if (!outgoing) outgoing = make(SRC.outgoing, 0.5);
  play(outgoing);
}
