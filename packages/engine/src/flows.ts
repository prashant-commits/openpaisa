import { addDays, addMonths, clampedDate, compareIso, dayOf, isMonthEnd } from './dates.js';
import type { Category, IsoDate, Loan, MonthlyFlow, Paise, ParsedStatement, RecurringPayment, Transaction, UpcomingOutflow } from './types.js';

const NOT_SPEND: ReadonlySet<Category> = new Set<Category>(['transfers', 'card_payment', 'investments']);
const NOT_INCOME: ReadonlySet<Category> = new Set<Category>(['refund', 'transfers', 'card_payment']);
const UPCOMING_DAYS = 45;

const PERIOD_MONTHS: Record<RecurringPayment['frequency'], number> = { weekly: 0, monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Median day of month of salary credits seen in at least two months. Month-end credits count as day 31. */
export function detectSalaryDay(txns: Transaction[]): number | undefined {
  const byMonth = new Map<string, number>();
  for (const t of txns) {
    if (t.direction !== 'credit') continue;
    if (t.category !== 'salary' && !/SALARY/i.test(t.rawDescription)) continue;
    const month = t.date.slice(0, 7);
    const day = isMonthEnd(t.date) ? 31 : dayOf(t.date);
    // Several salary-like credits in one month: keep the largest by taking the first seen per month.
    if (!byMonth.has(month)) byMonth.set(month, day);
  }
  if (byMonth.size >= 2) return Math.round(median([...byMonth.values()]));
  if (byMonth.size > 0) return undefined;
  return payrollSeriesDay(txns);
}

/**
 * No credit says SALARY: fall back to the largest same-payee credit series (category other)
 * seen in at least two calendar months with amounts within 10% of their median.
 */
function payrollSeriesDay(txns: Transaction[]): number | undefined {
  const byPayee = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.direction !== 'credit' || t.category !== 'other' || !t.merchant) continue;
    byPayee.set(t.merchant, [...(byPayee.get(t.merchant) ?? []), t]);
  }
  let best: { amount: number; day: number } | undefined;
  for (const list of byPayee.values()) {
    const mid = median(list.map((t) => t.amount));
    const near = list.filter((t) => Math.abs(t.amount - mid) <= mid * 0.1);
    const months = new Map<string, Transaction>();
    for (const t of near) if (!months.has(t.date.slice(0, 7))) months.set(t.date.slice(0, 7), t);
    if (months.size < 2) continue;
    const day = Math.round(median([...months.values()].map((t) => (isMonthEnd(t.date) ? 31 : dayOf(t.date)))));
    if (!best || mid > best.amount) best = { amount: mid, day };
  }
  return best?.day;
}

function cycleStart(date: IsoDate, salaryDay?: number): IsoDate {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (!salaryDay) return `${date.slice(0, 7)}-01`;
  const thisMonth = clampedDate(y, m, salaryDay);
  if (compareIso(date, thisMonth) >= 0) return thisMonth;
  const prev = addMonths(`${date.slice(0, 7)}-01`, -1);
  return clampedDate(Number(prev.slice(0, 4)), Number(prev.slice(5, 7)), salaryDay);
}

export function buildFlows(txns: Transaction[], salaryDay?: number): MonthlyFlow[] {
  const cycles = new Map<IsoDate, MonthlyFlow>();
  for (const t of txns) {
    const key = cycleStart(t.date, salaryDay);
    let flow = cycles.get(key);
    if (!flow) {
      flow = { cycleStart: key, income: 0, spend: 0, byCategory: {} };
      cycles.set(key, flow);
    }
    const cat: Category = t.category ?? 'other';
    if (t.direction === 'credit') {
      if (!NOT_INCOME.has(cat)) flow.income += t.amount;
    } else if (!NOT_SPEND.has(cat)) {
      flow.spend += t.amount;
      flow.byCategory[cat] = (flow.byCategory[cat] ?? 0) + t.amount;
    }
  }
  return [...cycles.values()].sort((a, b) => compareIso(a.cycleStart, b.cycleStart));
}

/** The statement with the latest due date for each credit card account. */
export function latestCardStatements(statements: ParsedStatement[]): ParsedStatement[] {
  const latest = new Map<string, ParsedStatement>();
  for (const s of statements) {
    if (!s.card) continue;
    const prev = latest.get(s.account.id);
    if (!prev || compareIso(s.card.dueDate, (prev.card as NonNullable<ParsedStatement['card']>).dueDate) > 0) latest.set(s.account.id, s);
  }
  return [...latest.values()];
}

export function buildUpcoming(recurring: RecurringPayment[], statements: ParsedStatement[], loans: Loan[], asOf: IsoDate): UpcomingOutflow[] {
  const end = addDays(asOf, UPCOMING_DAYS);
  const out: UpcomingOutflow[] = [];

  const loanTxnIds = loans.flatMap((l) => l.emiTransactionIds);
  for (const r of recurring) {
    const months = PERIOD_MONTHS[r.frequency];
    // The next date may already be clamped to a short month, so recover the billing day from the series
    // (same rule as recurring.nextExpected) and clamp each occurrence on its own.
    const nextIsEnd = isMonthEnd(r.nextExpectedDate);
    const anchor = isMonthEnd(r.lastDate) ? (nextIsEnd ? 31 : dayOf(r.nextExpectedDate)) : dayOf(r.lastDate);
    const firstOfNext = `${r.nextExpectedDate.slice(0, 7)}-01`;
    for (let k = 0; k < 400; k++) {
      let d: IsoDate;
      if (months === 0) d = addDays(r.nextExpectedDate, 7 * k);
      else {
        const first = addMonths(firstOfNext, months * k);
        d = clampedDate(Number(first.slice(0, 4)), Number(first.slice(5, 7)), anchor);
      }
      if (compareIso(d, end) > 0) break;
      if (compareIso(d, asOf) < 0) continue;
      out.push({ date: d, label: r.merchant, amount: r.typicalAmount, source: r.kind === 'emi' || loanTxnIds.some((id) => r.occurrences.includes(id)) ? 'emi' : 'recurring' });
    }
  }

  const recurringEmiIds = new Set(recurring.flatMap((r) => r.occurrences));
  const recurringEmiNames = new Set(recurring.filter((r) => r.kind === 'emi').map((r) => r.merchant.toLowerCase()));
  for (const l of loans) {
    if (!l.startDate || l.emi <= 0) continue;
    if (l.emiTransactionIds.some((id) => recurringEmiIds.has(id)) || recurringEmiNames.has(l.lender.toLowerCase())) continue;
    for (let k = 1; k <= 1200; k++) {
      const d = addMonths(l.startDate, k);
      if (compareIso(d, end) > 0) break;
      if (compareIso(d, asOf) >= 0) out.push({ date: d, label: `${l.lender} EMI`, amount: l.emi, source: 'emi' });
    }
  }

  for (const s of latestCardStatements(statements)) {
    const c = s.card as NonNullable<ParsedStatement['card']>;
    if (c.totalDue > 0 && compareIso(c.dueDate, asOf) >= 0 && compareIso(c.dueDate, end) <= 0) {
      out.push({ date: c.dueDate, label: `${s.account.institution} card due`, amount: c.totalDue, source: 'card_due' });
    }
  }

  return out.sort((a, b) => compareIso(a.date, b.date) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** The next payday strictly after asOf. */
export function nextSalaryDate(asOf: IsoDate, salaryDay: number): IsoDate {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  const thisMonth = clampedDate(y, m, salaryDay);
  if (compareIso(thisMonth, asOf) > 0) return thisMonth;
  const next = addMonths(`${asOf.slice(0, 7)}-01`, 1);
  return clampedDate(Number(next.slice(0, 4)), Number(next.slice(5, 7)), salaryDay);
}

/** Liquid balance: latest closing balance of each savings or current account. */
export function liquidBalance(statements: ParsedStatement[]): Paise | undefined {
  const latest = new Map<string, ParsedStatement>();
  for (const s of statements) {
    if ((s.account.kind !== 'savings' && s.account.kind !== 'current') || s.closingBalance === undefined) continue;
    const prev = latest.get(s.account.id);
    if (!prev || compareIso(s.periodEnd ?? '', prev.periodEnd ?? '') >= 0) latest.set(s.account.id, s);
  }
  if (!latest.size) return undefined;
  return [...latest.values()].reduce((sum, s) => sum + (s.closingBalance as number), 0);
}

export function safeToSpend(
  statements: ParsedStatement[],
  upcoming: UpcomingOutflow[],
  asOf: IsoDate,
  salaryDay?: number,
): { untilDate: IsoDate; amount: Paise } | undefined {
  if (!salaryDay) return undefined;
  const liquid = liquidBalance(statements);
  if (liquid === undefined) return undefined;
  const untilDate = nextSalaryDate(asOf, salaryDay);
  const committed = upcoming.filter((u) => compareIso(u.date, untilDate) < 0).reduce((s, u) => s + u.amount, 0);
  return { untilDate, amount: Math.max(0, liquid - committed) };
}
