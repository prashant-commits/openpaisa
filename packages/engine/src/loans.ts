import { addMonths, compareIso, diffDays } from './dates.js';
import type { AmortisationRow, IsoDate, Loan, Paise, PrepaymentResult, RecurringPayment, Transaction } from './types.js';

const MISSING_FACTS = 'loan needs principal, annualRatePct, tenureMonths and startDate';
const MAX_MONTHS = 1200;
/** A rounding residue this small after a regular EMI is folded into that payment. */
const RESIDUE = 1000;

interface Facts {
  principal: Paise;
  rate: number;
  tenure: number;
  start: IsoDate;
}

function facts(loan: Loan): Facts | undefined {
  const { principal, annualRatePct: rate, tenureMonths: tenure, startDate: start } = loan;
  if (!principal || rate === undefined || !tenure || !start) return undefined;
  return { principal, rate, tenure, start };
}

function rawEmi(principal: number, annualRatePct: number, n: number): number {
  const r = annualRatePct / 1200;
  if (r === 0) return principal / n;
  const g = Math.pow(1 + r, n);
  return (principal * r * g) / (g - 1);
}

/** Standard reducing-balance EMI, rounded to paise. */
export function emiFor(principal: Paise, annualRatePct: number, tenureMonths: number): Paise {
  return Math.round(rawEmi(principal, annualRatePct, tenureMonths));
}

function scheduledEmi(loan: Loan, f: Facts): Paise {
  return loan.emi > 0 ? loan.emi : emiFor(f.principal, f.rate, f.tenure);
}

/** Full schedule from startDate. The last row pays the exact outstanding plus interest. */
export function amortise(loan: Loan, asOf: IsoDate): AmortisationRow[] {
  void asOf;
  const f = facts(loan);
  if (!f) return [];
  const emi = scheduledEmi(loan, f);
  const rows: AmortisationRow[] = [];
  let bal = f.principal;
  for (let k = 1; k <= f.tenure; k++) {
    const interest = Math.round((bal * f.rate) / 1200);
    const last = k === f.tenure || emi >= bal + interest;
    const principal = last ? bal : emi - interest;
    bal -= principal;
    rows.push({ month: k, date: addMonths(f.start, k), emi: principal + interest, interest, principal, outstanding: bal });
    if (last) break;
  }
  return rows;
}

function paidCount(rows: AmortisationRow[], asOf: IsoDate): number {
  return rows.filter((r) => compareIso(r.date, asOf) <= 0).length;
}

/** Balance after every EMI dated on or before asOf. */
export function outstandingAt(loan: Loan, asOf: IsoDate): Paise {
  const f = facts(loan);
  if (!f) return loan.outstanding ?? 0;
  const rows = amortise(loan, asOf);
  const n = paidCount(rows, asOf);
  return n === 0 ? f.principal : (rows[n - 1] as AmortisationRow).outstanding;
}

/**
 * Pay `emi` each month on `balance` until cleared. Every payment, including a
 * final partial one, counts as a month. Capped so a too-small EMI cannot loop.
 */
function simulate(balance: Paise, annualRatePct: number, emi: Paise): { months: number; interest: Paise; capped: boolean } {
  let bal = balance;
  let months = 0;
  let interest = 0;
  while (bal > 0 && months < MAX_MONTHS) {
    const i = Math.round((bal * annualRatePct) / 1200);
    months++;
    interest += i;
    if (emi >= bal + i) {
      bal = 0;
      break;
    }
    bal = bal + i - emi;
    if (bal <= RESIDUE) {
      bal = 0;
      break;
    }
  }
  return { months, interest, capped: bal > 0 };
}

export function prepay(loan: Loan, amount: Paise, mode: 'reduce_tenure' | 'reduce_emi', asOf: IsoDate): PrepaymentResult {
  const f = facts(loan);
  if (!f) throw new Error(MISSING_FACTS);
  const rows = amortise(loan, asOf);
  const done = paidCount(rows, asOf);
  const remaining = rows.length - done;
  const outstanding = done === 0 ? f.principal : (rows[done - 1] as AmortisationRow).outstanding;
  const baselineInterest = rows.slice(done).reduce((s, r) => s + r.interest, 0);
  const emi = scheduledEmi(loan, f);
  const after = Math.max(0, outstanding - amount);

  if (after === 0) {
    return { prepayment: amount, mode, interestSaved: baselineInterest, monthsSaved: remaining, newEmi: 0 };
  }
  if (mode === 'reduce_tenure') {
    const sim = simulate(after, f.rate, emi);
    return { prepayment: amount, mode, interestSaved: baselineInterest - sim.interest, monthsSaved: remaining - sim.months, newEmi: emi };
  }
  const newEmi = emiFor(after, f.rate, remaining);
  const sim = simulate(after, f.rate, newEmi);
  return { prepayment: amount, mode, interestSaved: baselineInterest - sim.interest, monthsSaved: 0, newEmi };
}

/** Annual rate (%, 2 dp) at which `emi` amortises `principal` over the tenure. Bisection over 0..60%. */
export function solveRate(principal: Paise, emi: Paise, tenureMonths: number): number {
  let lo = 0;
  let hi = 60;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (rawEmi(principal, mid, tenureMonths) < emi) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
}

/**
 * Compare the EMI as set (at loan.annualRatePct) with what it would be at the
 * current rate over the same remaining tenure. `tenureExtendedMonths` is signed:
 * positive when a rate rise stretched the tenure, negative when a cut shortened it.
 */
export function rateResetCheck(loan: Loan, currentRatePct: number, asOf: IsoDate): { tenureExtendedMonths: number; emiIfReduced: Paise } | null {
  const f = facts(loan);
  if (!f) return null;
  const rows = amortise(loan, asOf);
  const remaining = rows.length - paidCount(rows, asOf);
  if (remaining <= 0) return null;
  const outstanding = outstandingAt(loan, asOf);
  const emiIfReduced = emiFor(outstanding, currentRatePct, remaining);
  const emi = scheduledEmi(loan, f);
  if (Math.abs(emiIfReduced - emi) <= 100) return null;
  const sim = simulate(outstanding, currentRatePct, emi);
  const months = sim.capped ? MAX_MONTHS : sim.months;
  return { tenureExtendedMonths: months - remaining, emiIfReduced };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function loanKind(text: string): Loan['kind'] {
  const t = text.toUpperCase();
  if (/EMI\s*\d+\s*\/\s*\d+/.test(t)) return 'card_emi';
  if (/\bHOME\b|\bHL\b|HOUSING/.test(t)) return 'home';
  if (/\bCAR\b|\bAUTO\b|VEHICLE/.test(t)) return 'car';
  if (/\bPL\b|PERSONAL/.test(t)) return 'personal';
  if (/\bEDU/.test(t)) return 'education';
  return 'other';
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function detectLoans(txns: Transaction[], recurring: RecurringPayment[]): Loan[] {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const covered = new Set<string>();
  const loans: Loan[] = [];

  for (const r of recurring) {
    if (r.kind !== 'emi') continue;
    const rows = r.occurrences.map((id) => byId.get(id)).filter((t): t is Transaction => !!t);
    r.occurrences.forEach((id) => covered.add(id));
    loans.push({
      id: `loan-${slug(r.merchant)}`,
      lender: r.merchant,
      kind: loanKind(`${r.merchant} ${rows.map((t) => t.rawDescription).join(' ')}`),
      emi: r.typicalAmount,
      emiTransactionIds: r.occurrences,
      confidence: 0.6,
    });
  }

  // NACH debits with a loan keyword that the recurring pass did not classify as an EMI.
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.direction !== 'debit' || t.channel !== 'nach' || covered.has(t.id)) continue;
    if (!/LOAN|EMI/i.test(t.rawDescription)) continue;
    const key = (t.merchant ?? t.rawDescription.toUpperCase().replace(/[^A-Z]+/g, ' ').trim()).toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => compareIso(a.date, b.date));
    if (sorted.length < 3) continue;
    const amounts = sorted.map((t) => t.amount);
    if (Math.max(...amounts) - Math.min(...amounts) > 100) continue;
    const gaps = sorted.slice(1).map((t, i) => diffDays((sorted[i] as Transaction).date, t.date));
    const g = median(gaps);
    if (g < 26 || g > 35) continue;
    const first = sorted[0] as Transaction;
    const lender = first.merchant ?? first.rawDescription;
    const id = `loan-${slug(lender)}`;
    if (loans.some((l) => l.id === id)) continue;
    loans.push({
      id,
      lender,
      kind: loanKind(sorted.map((t) => `${t.merchant ?? ''} ${t.rawDescription}`).join(' ')),
      emi: (sorted[sorted.length - 1] as Transaction).amount,
      emiTransactionIds: sorted.map((t) => t.id),
      confidence: 0.6,
    });
  }
  return loans;
}
