/* ============================================================
 * CircleChat 前端 — 音效
 * 收到他人新消息（可切换提示音）/ 自己发送消息时的提示音。
 * 音效来源：Pixabay（作者 universfield），许可见 CREDITS.md。
 *
 * 说明：
 * - 音频元素按需创建并缓存；设置 currentTime 与 play() 分别用 try 包裹，
 *   前者在媒体未就绪时可能抛错，绝不能让它阻断后面的 play()。
 * - 受浏览器自动播放策略限制，用户首次交互前 play() 会被拒绝，此处静默忽略。
 * ============================================================ */

import { url } from './api';

const AUDIO_DIR = '/audio/';
/** 发送提示音（固定） */
const OUTGOING_FILE = 'universfield-message-ping-351298.mp3';

export interface NotifySound {
  file: string;
  label: string;
}

/** 可选的消息提示音（来自 Pixabay · universfield，见 CREDITS.md） */
export const NOTIFY_SOUNDS: NotifySound[] = [
  { file: 'universfield-new-notification-018-363746.mp3', label: '提示音 018' },
  { file: 'universfield-new-notification-020-352772.mp3', label: '提示音 020' },
  { file: 'universfield-new-notification-03-323602.mp3', label: '提示音 03' },
  { file: 'universfield-new-notification-033-480571.mp3', label: '提示音 033' },
  { file: 'universfield-new-notification-044-494239.mp3', label: '提示音 044' },
  { file: 'universfield-new-notification-049-494249.mp3', label: '提示音 049' },
  { file: 'universfield-new-notification-056-494256.mp3', label: '提示音 056' },
  { file: 'universfield-new-notification-064-494547.mp3', label: '提示音 064' },
  { file: 'universfield-new-notification-09-352705.mp3', label: '提示音 09' }
];

export const DEFAULT_NOTIFY_SOUND = NOTIFY_SOUNDS[0].file;

const hasAudio = typeof Audio !== 'undefined';

function make(src: string, volume: number): HTMLAudioElement | null {
  if (!hasAudio) return null;
  const a = new Audio(src);
  a.preload = 'auto';
  a.volume = volume;
  return a;
}

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

const outgoing = make(url(AUDIO_DIR + OUTGOING_FILE), 0.5);

const notifyCache = new Map<string, HTMLAudioElement>();
let notifyFile = DEFAULT_NOTIFY_SOUND;

/** 是否为合法的可选提示音 */
export function isNotifySound(file: string): boolean {
  return NOTIFY_SOUNDS.some((s) => s.file === file);
}

/** 设置当前消息提示音（仅接受清单内的文件） */
export function setNotifySound(file: string): void {
  if (isNotifySound(file)) notifyFile = file;
}

function notifyAudio(file: string): HTMLAudioElement | null {
  const f = isNotifySound(file) ? file : notifyFile;
  let a = notifyCache.get(f);
  if (!a) {
    a = make(url(AUDIO_DIR + f), 0.6) || undefined;
    if (a) notifyCache.set(f, a);
  }
  return a || null;
}

/** 收到他人新消息 */
export function playIncoming(): void {
  play(notifyAudio(notifyFile));
}

/** 自己发送消息（文本 / 文件） */
export function playOutgoing(): void {
  play(outgoing);
}

/** 设置面板试听指定提示音 */
export function playNotifyPreview(file: string): void {
  play(notifyAudio(file));
}

/** 设置面板试听「发送提示音」（打开开关时给个反馈） */
export function playOutgoingPreview(): void {
  play(outgoing);
}
