import { categoriseTransactions } from './categorise.js';
import { compareIso } from './dates.js';
import { dedupeTransactions } from './dedupe.js';
import { detectFees } from './fees.js';
import { buildFlows, buildUpcoming, detectSalaryDay, latestCardStatements, safeToSpend } from './flows.js';
import { buildInsights } from './insights.js';
import { detectLoans, emiFor, outstandingAt } from './loans.js';
import { normaliseTransactions } from './normalise.js';
import { detectRecurring } from './recurring.js';
import type { Account, AuditInput, AuditReport, CardSummary, InsightKind, Loan, Transaction } from './types.js';

const LEAK_KINDS: ReadonlySet<InsightKind> = new Set<InsightKind>([
  'forgotten_subscription', 'duplicate_subscription', 'price_increase', 'fee_paid',
  'late_fee', 'card_interest', 'forex_markup', 'duplicate_charge',
]);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sameLender = (a: string, b: string) => {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
};

function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Merge detected loans with user-supplied facts. User fields win; unmatched user loans are added. */
function mergeLoans(detected: Loan[], supplied: Partial<Loan>[] = []): Loan[] {
  const used = new Set<number>();
  const merged = detected.map((d) => {
    const i = supplied.findIndex((u, idx) => !used.has(idx) && !!u.lender && sameLender(u.lender, d.lender));
    if (i < 0) return d;
    used.add(i);
    return { ...d, ...defined(supplied[i] as Partial<Loan>) } as Loan;
  });
  supplied.forEach((u, idx) => {
    if (used.has(idx)) return;
    const lender = u.lender ?? 'Loan';
    const hasFacts = !!u.principal && u.annualRatePct !== undefined && !!u.tenureMonths;
    merged.push({
      id: `loan-${slug(lender)}`,
      lender,
      kind: 'other',
      emi: u.emi ?? (hasFacts ? emiFor(u.principal as number, u.annualRatePct as number, u.tenureMonths as number) : 0),
      emiTransactionIds: [],
      confidence: 0.9,
      ...defined(u),
    } as Loan);
  });
  return merged;
}

/** Run the full audit. Pure function: same input, same output. */
export function runAudit(input: AuditInput): AuditReport {
  const { statements, asOf } = input;

  const accounts: Account[] = [];
  for (const s of statements) if (!accounts.some((a) => a.id === s.account.id)) accounts.push(s.account);
  const cardAccountIds = new Set(accounts.filter((a) => a.kind === 'credit_card').map((a) => a.id));

  const raw = statements.flatMap((s) => s.transactions);
  const txns: Transaction[] = categoriseTransactions(dedupeTransactions(normaliseTransactions(raw))).sort(
    (a, b) => compareIso(a.date, b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const recurring = detectRecurring(txns, asOf);
  const loans = mergeLoans(detectLoans(txns, recurring), input.loans).map((l) => {
    const hasFacts = !!l.principal && l.annualRatePct !== undefined && !!l.tenureMonths && !!l.startDate;
    return l.outstanding === undefined && hasFacts ? { ...l, outstanding: outstandingAt(l, asOf) } : l;
  });
  const fees = detectFees(txns, asOf, cardAccountIds);

  const salaryDay = input.salaryDay ?? detectSalaryDay(txns);
  const flows = buildFlows(txns, salaryDay);
  const avgMonthlySpend = flows.length ? Math.round(flows.reduce((s, f) => s + f.spend, 0) / flows.length) : 0;

  const insights = buildInsights({ txns, statements, recurring, loans, fees, asOf, avgMonthlySpend });
  const upcoming = buildUpcoming(recurring, statements, loans, asOf);

  const cards: CardSummary[] = latestCardStatements(statements).map((s) => {
    const c = s.card as NonNullable<typeof s.card>;
    const limit = s.account.creditLimit;
    return {
      accountId: s.account.id,
      totalDue: c.totalDue,
      minimumDue: c.minimumDue,
      dueDate: c.dueDate,
      ...(c.statementDate ? { statementDate: c.statementDate } : {}),
      ...(limit ? { creditLimit: limit, utilisationPct: Math.round((c.totalDue * 1000) / limit) / 10 } : {}),
    };
  });

  const safe = safeToSpend(statements, upcoming, asOf, salaryDay);

  return {
    asOf,
    accounts,
    transactions: txns,
    recurring,
    loans,
    insights,
    headline: {
      annualLeak: insights.filter((i) => LEAK_KINDS.has(i.kind)).reduce((s, i) => s + (i.annualImpact ?? 0), 0),
      recurringAnnual: recurring.reduce((s, r) => s + r.annualCost, 0),
      emiMonthly: loans.reduce((s, l) => s + l.emi, 0),
    },
    flows,
    upcoming,
    cards,
    ...(safe ? { safeToSpend: safe } : {}),
  };
}
