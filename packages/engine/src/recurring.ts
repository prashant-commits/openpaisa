import { addDays, addMonths, compareIso, diffDays } from './dates.js';
import type { Category, Frequency, IsoDate, Paise, RecurringPayment, Transaction } from './types.js';

const FREQUENCIES: { freq: Frequency; min: number; max: number; perYear: number; months: number; days: number }[] = [
  { freq: 'weekly', min: 6, max: 8, perYear: 52, months: 0, days: 7 },
  { freq: 'monthly', min: 26, max: 35, perYear: 12, months: 1, days: 30 },
  { freq: 'quarterly', min: 85, max: 95, perYear: 4, months: 3, days: 91 },
  { freq: 'half_yearly', min: 175, max: 190, perYear: 2, months: 6, days: 182 },
  { freq: 'yearly', min: 355, max: 375, perYear: 1, months: 12, days: 365 },
];

/** Categories that are never "a recurring payment" in the leak sense. */
const EXCLUDED: ReadonlySet<Category> = new Set<Category>([
  'card_payment', 'cash_withdrawal', 'transfers', 'salary', 'refund', 'interest', 'fees_charges',
]);
const VARIABLE: ReadonlySet<Category> = new Set<Category>(['utilities', 'telecom']);

const VIDEO = ['netflix', 'hotstar', 'prime video', 'sonyliv', 'sony liv', 'zee5', 'jiocinema', 'jio cinema', 'disney', 'apple tv', 'hbo', 'mubi', 'aha'];
const MUSIC = ['spotify', 'gaana', 'wynk', 'jiosaavn', 'saavn', 'apple music', 'youtube music'];

/** Group label for overlapping subscription services (e.g. two video OTTs), or undefined. */
export function subscriptionGroup(merchant: string): string | undefined {
  const m = merchant.toLowerCase();
  if (VIDEO.some((v) => m.includes(v))) return 'video streaming';
  if (MUSIC.some((v) => m.includes(v))) return 'music streaming';
  return undefined;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Normalised payee identity: the merchant when known, else the leading words of the description. */
export function payeeKey(t: Transaction): string {
  if (t.merchant) return t.merchant.trim().toLowerCase();
  return t.rawDescription.toUpperCase().replace(/[^A-Z]+/g, ' ').split(' ').filter((w) => w.length >= 3).slice(0, 3).join(' ');
}

function displayName(t: Transaction, key: string): string {
  return t.merchant?.trim() || key;
}

function monthLen(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

function nextExpected(last: IsoDate, anchorDay: number, f: (typeof FREQUENCIES)[number]): IsoDate {
  if (f.months === 0) return addDays(last, f.days);
  const first = addMonths(`${last.slice(0, 7)}-01`, f.months);
  const y = Number(first.slice(0, 4));
  const m0 = Number(first.slice(5, 7)) - 1;
  const day = Math.min(anchorDay, monthLen(y, m0));
  return `${first.slice(0, 8)}${String(day).padStart(2, '0')}`;
}

function majority<T>(items: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  let best: T | undefined;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

function kindOf(category: Category | undefined, descriptions: string): RecurringPayment['kind'] {
  switch (category) {
    case 'emi': return 'emi';
    case 'investments': return 'sip';
    case 'insurance': return 'insurance';
    case 'rent': return 'rent';
    case 'utilities': case 'telecom': return 'utility';
    case 'subscriptions': case 'entertainment': return 'subscription';
    default: break;
  }
  if (category && category !== 'other') return 'other';
  const d = descriptions.toUpperCase();
  if (/\bEMI\b|\bLOAN\b/.test(d)) return 'emi';
  if (/\bSIP\b|MUTUAL FUND/.test(d)) return 'sip';
  if (/INSURANCE|\bLIC\b|PREMIUM/.test(d)) return 'insurance';
  if (/\bRENT\b/.test(d)) return 'rent';
  return 'other';
}

/** Split sorted-by-amount transactions into amount bands (symmetric tolerance). */
function makeBands(txns: Transaction[], tol: number): Transaction[][] {
  const byAmount = [...txns].sort((a, b) => a.amount - b.amount);
  const ratio = (1 + tol) / (1 - tol);
  const bands: Transaction[][] = [];
  let cur: Transaction[] = [];
  for (const t of byAmount) {
    const first = cur[0];
    if (first && t.amount <= first.amount * ratio) cur.push(t);
    else {
      if (cur.length) bands.push(cur);
      cur = [t];
    }
  }
  if (cur.length) bands.push(cur);
  return bands;
}

const byDate = (a: Transaction, b: Transaction) => compareIso(a.date, b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Bands that follow each other in time (a price change) can be merged into one
 * series; interleaved bands are separate plans.
 */
function mergeSequential(bands: Transaction[][]): Transaction[][] | undefined {
  if (bands.length > 3) return undefined;
  const sorted = bands.map((b) => [...b].sort(byDate)).sort((a, b) => compareIso((a[0] as Transaction).date, (b[0] as Transaction).date));
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i] as Transaction[];
    const next = sorted[i + 1] as Transaction[];
    if (cur.length < 2) return undefined;
    if (compareIso((cur[cur.length - 1] as Transaction).date, (next[0] as Transaction).date) >= 0) return undefined;
  }
  return sorted;
}

interface Series {
  txns: Transaction[]; // sorted by date
  bands?: Transaction[][]; // present when a price change was merged
}

function analyse(series: Series, key: string, asOf: IsoDate): RecurringPayment | undefined {
  const txns = series.txns;
  const last = txns[txns.length - 1] as Transaction;

  // Gaps are measured within each account so one charge on two cards does not create zero gaps.
  const byAccount = new Map<string, Transaction[]>();
  for (const t of txns) byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);
  const gaps: number[] = [];
  for (const list of byAccount.values()) {
    for (let i = 1; i < list.length; i++) gaps.push(diffDays((list[i - 1] as Transaction).date, (list[i] as Transaction).date));
  }
  if (!gaps.length) return undefined;
  const gap = median(gaps);
  const f = FREQUENCIES.find((x) => gap >= x.min && gap <= x.max);
  if (!f) return undefined;
  if (txns.length < (f.freq === 'yearly' ? 2 : 3)) return undefined;
  if (diffDays(last.date, asOf) > f.days * 1.5 + 15) return undefined; // lapsed / cancelled

  const category = majority(txns.map((t) => t.category).filter((c): c is Category => !!c));
  const kind = kindOf(category, txns.map((t) => t.rawDescription).join(' '));
  const name = displayName(txns[0] as Transaction, key);
  const typicalAmount: Paise = last.amount;

  const day = Number(last.date.slice(8, 10));
  const lastIsMonthEnd = day === monthLen(Number(last.date.slice(0, 4)), Number(last.date.slice(5, 7)) - 1);
  const anchorDay = lastIsMonthEnd ? Math.max(...txns.map((t) => Number(t.date.slice(8, 10)))) : day;

  let priceChange: RecurringPayment['priceChange'];
  if (series.bands && series.bands.length > 1) {
    const b = series.bands;
    const prev = b[b.length - 2] as Transaction[];
    const next = b[b.length - 1] as Transaction[];
    priceChange = {
      from: (prev[prev.length - 1] as Transaction).amount,
      to: (next[0] as Transaction).amount,
      on: (next[0] as Transaction).date,
    };
  }

  // possiblyForgotten heuristics
  let possiblyForgotten = false;
  if (kind === 'subscription' && f.freq === 'monthly' && typicalAmount <= 50000 && txns.length >= 6) possiblyForgotten = true;
  const months = new Map<string, Set<string>>();
  for (const t of txns) {
    const m = t.date.slice(0, 7);
    months.set(m, (months.get(m) ?? new Set()).add(t.accountId));
  }
  if ([...months.values()].some((s) => s.size >= 2)) possiblyForgotten = true;

  return {
    id: `rec-${slug(name)}-${f.freq}`,
    merchant: name,
    category: category ?? 'other',
    frequency: f.freq,
    typicalAmount,
    annualCost: typicalAmount * f.perYear,
    lastDate: last.date,
    nextExpectedDate: nextExpected(last.date, anchorDay, f),
    occurrences: txns.map((t) => t.id),
    kind,
    ...(priceChange ? { priceChange } : {}),
    possiblyForgotten,
    confidence: Math.min(0.95, 0.5 + 0.08 * txns.length),
  };
}

export function detectRecurring(txns: Transaction[], asOf: IsoDate): RecurringPayment[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.direction !== 'debit') continue;
    if (t.category && EXCLUDED.has(t.category)) continue;
    const key = payeeKey(t);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const found: RecurringPayment[] = [];
  for (const [key, list] of groups) {
    const category = majority(list.map((t) => t.category).filter((c): c is Category => !!c));
    const tol = category && VARIABLE.has(category) ? 0.3 : 0.05;
    const bands = makeBands(list, tol);
    const series: Series[] = [];
    if (bands.length === 1) series.push({ txns: [...list].sort(byDate) });
    else {
      const merged = mergeSequential(bands);
      if (merged) series.push({ txns: merged.flat(), bands: merged });
      else for (const b of bands) series.push({ txns: [...b].sort(byDate) });
    }
    for (const s of series) {
      const r = analyse(s, key, asOf);
      if (r) found.push(r);
    }
  }

  // Duplicate sort of ids (two concurrent plans of one merchant): disambiguate by amount.
  const seen = new Map<string, number>();
  for (const r of found) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  for (const r of found) if ((seen.get(r.id) ?? 0) > 1) r.id = `${r.id}-${r.typicalAmount}`;

  return found.sort((a, b) => b.annualCost - a.annualCost || (a.id < b.id ? -1 : 1));
}
