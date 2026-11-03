import type { IsoDate } from './types.js';

const DAY_MS = 86_400_000;

function parse(d: IsoDate): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
}

function format(ms: number): IsoDate {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return format(parse(d) + n * DAY_MS);
}

/** Add calendar months, clamping the day to the end of the target month. */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return format(Date.UTC(ty, tm, Math.min(day, last)));
}

/** Whole days from a to b (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((parse(b) - parse(a)) / DAY_MS);
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The ISO date for year/month(1-12)/day, with the day clamped to the month's length. */
export function clampedDate(year: number, month: number, day: number): IsoDate {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return format(Date.UTC(year, month - 1, Math.min(day, last)));
}

/** Day of month (1-31) of an ISO date. */
export function dayOf(d: IsoDate): number {
  return Number(d.slice(8, 10));
}

/** True when the date is the last day of its month. */
export function isMonthEnd(d: IsoDate): boolean {
  return addDays(d, 1).slice(8, 10) === '01';
}
