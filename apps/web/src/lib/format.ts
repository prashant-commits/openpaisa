import type { Category, IsoDate } from '@openpaisa/engine';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-05" -> "5 Nov 2026" without going through Date (no timezone surprises). */
export function fmtDate(iso: IsoDate): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1] ?? '?'} ${y}`;
}

/** "2026-10-01" -> "Oct 2026" */
export function fmtMonth(iso: IsoDate): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1] ?? '?'} ${y}`;
}

export function fmtCategory(c: Category): string {
  const s = c.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The device's local calendar date as YYYY-MM-DD (toISOString would give the UTC date). */
export function localIsoDate(now: Date = new Date()): IsoDate {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
