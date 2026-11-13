// 时间工具：统一时间戳格式，便于 SQL 排序与 substring 聚合

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

/** 本地时间字符串 YYYY-MM-DD HH:mm:ss */
export function nowIso(): string {
  const d = new Date();
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  );
}

/** 仅日期 YYYY-MM-DD */
export function today(): string {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 当前年份 */
export function currentYear(): number {
  return new Date().getFullYear();
}

/** 毫秒时间戳 */
export function nowMs(): number {
  return Date.now();
}