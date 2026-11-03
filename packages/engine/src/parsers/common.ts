import { formatINR } from '../money.js';
import type { Direction, IsoDate, Paise, Source, Transaction } from '../types.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Source of a regex matching any date format Indian statements use (DD-first). */
export const DATE_SRC =
  '\\d{1,2}[/-]\\d{1,2}[/-](?:\\d{4}|\\d{2})\\b|\\d{1,2}[ -](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ -](?:\\d{4}|\\d{2})\\b';

function validDate(y: number, m: number, d: number): IsoDate | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
  if (d > dim) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const fullYear = (s: string): number => (s.length === 2 ? 2000 + Number(s) : Number(s));

/** Parse an Indian (day-first) date into ISO. Returns null when it is not a real date. */
export function parseIndianDate(s: string): IsoDate | null {
  const t = s.trim();
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(t);
  if (m) return validDate(fullYear(m[3]!), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{4}|\d{2})$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[2]!.toLowerCase());
    return mi < 0 ? null : validDate(fullYear(m[3]!), mi + 1, Number(m[1]));
  }
  return null;
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0);
}

export interface AmountMatch {
  value: Paise;
  marker?: 'Dr' | 'Cr';
  /** Printed with a leading minus sign or in brackets. Cards read it as a credit, savings and CSV as a debit. */
  negative?: boolean;
  index: number;
  length: number;
}

/** Find every money amount in a line (must have two decimals, so refs and rates are ignored). */
export function findAmounts(line: string, opts: { letterMarkers?: boolean } = {}): AmountMatch[] {
  const mk = opts.letterMarkers ? 'Dr|Cr|D|C' : 'Dr|Cr';
  // The amount may follow 'Rs.' / 'Rs' / 'INR' / the rupee sign, or carry a leading minus after whitespace.
  const start = '(?:(?<!\\S)(-)|(?<![\\w.,/-])|(?<=\\b(?:Rs|INR)\\.?\\s?)|(?<=\u20B9\\s?))';
  const re = new RegExp(`(\\()?${start}(\\d{1,3}(?:,\\d{2,3})+|\\d+)\\.(\\d{2})(?![\\d%])(\\))?(?:\\s*\\(?\\b(${mk})\\b\\)?(?![\\w]))?`, 'gi');
  const out: AmountMatch[] = [];
  for (const m of line.matchAll(re)) {
    const value = Number(m[3]!.replace(/,/g, '')) * 100 + Number(m[4]);
    const bracketed = Boolean(m[1] && m[5]);
    const letter = m[6]?.toLowerCase();
    const marker: 'Dr' | 'Cr' | undefined = letter ? (letter[0] === 'd' ? 'Dr' : 'Cr') : undefined;
    const a: AmountMatch = { value, index: m.index ?? 0, length: m[0].length };
    if (marker) a.marker = marker;
    if (m[2] || (bracketed && !marker)) a.negative = true;
    out.push(a);
  }
  return out;
}

export function extractAmounts(line: string, opts: { letterMarkers?: boolean } = {}): { value: Paise; marker?: 'Dr' | 'Cr' }[] {
  return findAmounts(line, opts).map(({ value, marker }) => (marker ? { value, marker } : { value }));
}

/** Join wrapped lines onto the row they belong to. Lines before the first row start are dropped. */
export function assembleRows(lines: string[], isRowStart: (l: string) => boolean): string[] {
  const rows: string[] = [];
  for (const l of lines) {
    if (isRowStart(l)) rows.push(l);
    else if (rows.length > 0) rows[rows.length - 1] += ' ' + l;
  }
  return rows;
}

/** opening + credits - debits = closing. Returns a warning, or null when it reconciles or cannot be checked. */
export function checkBalances(opening: Paise | undefined, txns: Transaction[], closing: Paise | undefined): string | null {
  if (opening === undefined || closing === undefined) return null;
  let sum = opening;
  for (const t of txns) sum += t.direction === 'credit' ? t.amount : -t.amount;
  if (sum === closing) return null;
  return `Balance does not reconcile: opening ${formatINR(opening, { decimals: true })} plus the rows gives ${formatINR(sum, { decimals: true })}, but the statement says ${formatINR(closing, { decimals: true })}.`;
}

/** FNV-1a 32-bit hash of the parts, as 8 hex characters. */
export function makeId(parts: (string | number)[]): string {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function makeTransaction(p: {
  accountId: string;
  date: IsoDate;
  amount: Paise;
  direction: Direction;
  rawDescription: string;
  balanceAfter?: Paise;
  seq: number;
  source?: Source;
}): Transaction {
  const t: Transaction = {
    id: makeId([p.accountId, p.date, p.amount, p.direction, p.rawDescription, p.seq]),
    accountId: p.accountId,
    date: p.date,
    amount: p.amount,
    direction: p.direction,
    rawDescription: p.rawDescription,
    channel: 'other',
    source: p.source ?? 'statement_pdf',
    confidence: 0.9,
  };
  if (p.balanceAfter !== undefined) t.balanceAfter = p.balanceAfter;
  return t;
}

/** Occurrence index of an identical row earlier in the same statement (the `seq` for makeTransaction). */
export function nextSeq(counts: Map<string, number>, ...key: (string | number)[]): number {
  const k = key.join('|');
  const n = counts.get(k) ?? 0;
  counts.set(k, n + 1);
  return n;
}

/** Build a detect() from a bank identity (checked in the first 40 lines) and statement-kind markers. */
export function makeDetect(spec: { identity: RegExp; kind: RegExp[]; anti?: RegExp[] }): (text: string) => number {
  return (text) => {
    const head = text.split(/\r?\n/).slice(0, 40).join('\n');
    if (!spec.identity.test(head)) return 0;
    const hits = spec.kind.filter((r) => r.test(text)).length;
    const f = hits / spec.kind.length;
    if (spec.anti?.some((r) => r.test(text))) return Math.min(0.3, f);
    return f >= 0.6 ? 0.5 + 0.5 * f : 0.3 * f;
  };
}

/** Last four digits found in a masked account/card number string. */
export function last4Of(s: string | undefined): string | undefined {
  return s ? /(\d{4})\D*$/.exec(s)?.[1] : undefined;
}

/** First date in a string, parsed. */
export function firstDate(s: string): IsoDate | null {
  const m = new RegExp(DATE_SRC, 'i').exec(s);
  return m ? parseIndianDate(m[0]) : null;
}

/** Statement period from a "<date> to <date>" pair anywhere in the header lines. */
export function findPeriod(lines: string[]): { start?: IsoDate; end?: IsoDate } {
  const re = new RegExp(`(${DATE_SRC})\\s*(?:to|-|–)\\s*:?\\s*(${DATE_SRC})`, 'i');
  for (const l of lines.slice(0, 40)) {
    const m = re.exec(l);
    if (!m) continue;
    const start = parseIndianDate(m[1]!);
    const end = parseIndianDate(m[2]!);
    if (start && end) return { start, end };
  }
  return {};
}

/** First amount following a label on the same line. */
export function labelAmount(text: string, label: RegExp): Paise | undefined {
  for (const l of splitLines(text)) {
    const m = label.exec(l);
    if (!m) continue;
    const a = findAmounts(l.slice(m.index + m[0].length))[0];
    if (a) return a.value;
  }
  return undefined;
}

/** First date following a label on the same line. */
export function labelDate(text: string, label: RegExp): IsoDate | undefined {
  for (const l of splitLines(text)) {
    const m = label.exec(l);
    if (!m) continue;
    const d = firstDate(l.slice(m.index + m[0].length));
    if (d) return d;
  }
  return undefined;
}
