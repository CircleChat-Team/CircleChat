/* ============================================================
 * ChatPlus 前端 — 展示格式化
 * ============================================================ */

function p2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** 日期：YYYY-MM-DD */
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

/** 文件体积：B / KB / MB */
export function fmtSize(n?: number | null): string {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}
