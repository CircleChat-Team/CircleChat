// CircleChat 前端 — 展示格式化

function p2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function fmtDate(ts?: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

/** 日期时间：MM-DD hh:mm:ss */
export function fmtDateTime(ts?: number | null): string {
  const d = new Date(Number(ts) || 0);
  return (
    p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
    p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())
  );
}

export function fmtSize(n?: number | null): string {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

/**
 * 「最后在线」的相对时间描述：返回文案 key（与参数），由调用方交给 tr/trn 渲染。
 * 纯函数、不依赖 i18n，方便单测；超过一周就直接给日期，再算「N 天前」就没意义了。
 */
export type LastSeenLabel =
  | { key: 'common.lastSeen.now' }
  | { key: 'common.lastSeen.minute'; n: number }
  | { key: 'common.lastSeen.hour'; n: number }
  | { key: 'common.lastSeen.day'; n: number }
  | { key: 'common.lastSeen.date'; date: string };

export function lastSeenLabel(ts?: number | null, now: number = Date.now()): LastSeenLabel | null {
  const t = Number(ts) || 0;
  if (t <= 0) return null;
  const diff = now - t;
  if (diff < 0 || diff < 60 * 1000) return { key: 'common.lastSeen.now' };
  const min = Math.floor(diff / 60000);
  if (min < 60) return { key: 'common.lastSeen.minute', n: min };
  const hour = Math.floor(min / 60);
  if (hour < 24) return { key: 'common.lastSeen.hour', n: hour };
  const day = Math.floor(hour / 24);
  if (day < 7) return { key: 'common.lastSeen.day', n: day };
  return { key: 'common.lastSeen.date', date: fmtDate(t) };
}
