import { addDays, compareIso, diffDays } from './dates.js';
import { buildUpcoming, latestCardStatements, liquidBalance } from './flows.js';
import { amortise, prepay, rateResetCheck, solveRate } from './loans.js';
import { formatINR } from './money.js';
import { payeeKey, subscriptionGroup } from './recurring.js';
import type { Category, Insight, IsoDate, Loan, Paise, ParsedStatement, RecurringPayment, Transaction } from './types.js';

export interface InsightContext {
  txns: Transaction[];
  statements: ParsedStatement[];
  recurring: RecurringPayment[];
  loans: Loan[];
  fees: Insight[];
  asOf: IsoDate;
  avgMonthlySpend: Paise;
}

const SEVERITY_RANK: Record<Insight['severity'], number> = { act: 0, warn: 1, info: 2 };
const NOT_A_PAYEE: ReadonlySet<Category> = new Set<Category>(['transfers', 'card_payment', 'cash_withdrawal', 'salary', 'refund']);
/** Categories where identical same-day debits are normal or already covered elsewhere. */
const NOT_A_PURCHASE: ReadonlySet<Category> = new Set<Category>([
  'cash_withdrawal', 'transfers', 'card_payment', 'investments', 'emi', 'rent', 'salary', 'refund', 'interest', 'fees_charges',
]);
const UNKNOWN_DEBIT_MIN: Paise = 1_000_000; // ₹10,000

const periodsPerYear = (r: RecurringPayment): number => Math.round(r.annualCost / r.typicalAmount);
const FREQ_WORD: Record<RecurringPayment['frequency'], string> = { weekly: 'weekly', monthly: 'monthly', quarterly: 'every quarter', half_yearly: 'every six months', yearly: 'yearly' };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function duplicateSubscriptions(recurring: RecurringPayment[], txns: Transaction[]): { insights: Insight[]; covered: Set<string> } {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const subs = recurring.filter((r) => r.kind === 'subscription');
  const insights: Insight[] = [];
  const covered = new Set<string>();

  const groups = new Map<string, RecurringPayment[]>();
  for (const r of subs) {
    const g = subscriptionGroup(r.merchant);
    if (g) groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  for (const [group, members] of groups) {
    if (members.length < 2) continue;
    const cheapest = members.reduce((a, b) => (b.annualCost < a.annualCost ? b : a));
    const total = members.reduce((s, r) => s + r.annualCost, 0);
    members.forEach((r) => covered.add(r.id));
    insights.push({
      id: `duplicate_subscription-${slug(group)}`,
      kind: 'duplicate_subscription',
      severity: 'warn',
      title: `${members.length} ${group} subscriptions: ${members.map((r) => r.merchant).join(', ')}`,
      detail: `Together they cost ${formatINR(total)} a year. The cheaper one, ${cheapest.merchant} at ${formatINR(cheapest.typicalAmount)} ${FREQ_WORD[cheapest.frequency]}, is ${formatINR(cheapest.annualCost)} a year.`,
      annualImpact: cheapest.annualCost,
      transactionIds: members.flatMap((r) => r.occurrences),
      action: { label: 'Review subscriptions', kind: 'cancel' },
    });
  }

  for (const r of subs) {
    if (covered.has(r.id)) continue;
    const perMonth = new Map<string, Set<string>>();
    for (const id of r.occurrences) {
      const t = byId.get(id);
      if (t) perMonth.set(t.date.slice(0, 7), (perMonth.get(t.date.slice(0, 7)) ?? new Set()).add(t.accountId));
    }
    if (![...perMonth.values()].some((s) => s.size >= 2)) continue;
    covered.add(r.id);
    insights.push({
      id: `duplicate_subscription-${r.id}`,
      kind: 'duplicate_subscription',
      severity: 'warn',
      title: `${r.merchant} is charged on more than one account`,
      detail: `${r.merchant} appears on two accounts in the same month at ${formatINR(r.typicalAmount)} ${FREQ_WORD[r.frequency]}. One of them costs ${formatINR(r.annualCost)} a year.`,
      annualImpact: r.annualCost,
      transactionIds: r.occurrences,
      action: { label: 'Review subscriptions', kind: 'cancel' },
    });
  }
  return { insights, covered };
}

function loanInsights(loans: Loan[], asOf: IsoDate): Insight[] {
  const out: Insight[] = [];
  for (const loan of loans) {
    const { principal, annualRatePct: rate, tenureMonths, startDate } = loan;
    if (!principal || rate === undefined || !tenureMonths || !startDate || loan.emi <= 0) continue;
    const implied = solveRate(principal, loan.emi, tenureMonths);
    const remainingOn = (l: Loan) => amortise(l, asOf).filter((r) => compareIso(r.date, asOf) > 0).length;
    const remaining = remainingOn(loan);
    if (remaining <= 0) continue;

    if (Math.abs(implied - rate) >= 0.05) {
      // The EMI was set at the implied rate; the user-supplied rate is the one in force now.
      const original: Loan = { ...loan, annualRatePct: implied };
      const check = rateResetCheck(original, rate, asOf);
      if (check) {
        const originalRemaining = remainingOn(original);
        const { tenureExtendedMonths: ext, emiIfReduced } = check;
        const lead = `At ${rate}%, the EMI for the remaining ${originalRemaining} months would be ${formatINR(emiIfReduced)}.`;
        const tail =
          ext < 0
            ? `Keeping ${formatINR(loan.emi)} ends the loan ${-ext} months sooner.`
            : `Keeping ${formatINR(loan.emi)} makes the loan run ${ext} months longer.`;
        out.push({
          id: `loan_rate_reset-${loan.id}`,
          kind: 'loan_rate_reset',
          severity: 'warn',
          title: `${loan.lender}: the EMI matches ${implied}% but the rate on record is ${rate}%`,
          detail: `${lead} ${tail}`,
          ...(emiIfReduced < loan.emi ? { annualImpact: (loan.emi - emiIfReduced) * 12 } : {}),
          transactionIds: loan.emiTransactionIds,
          action: { label: 'Write to bank', kind: 'letter' },
        });
      }
    }

    const amount = loan.emi * 6;
    const result = prepay(loan, amount, 'reduce_tenure', asOf);
    if (result.monthsSaved > 0 && result.interestSaved > 0) {
      out.push({
        id: `prepayment_opportunity-${loan.id}`,
        kind: 'prepayment_opportunity',
        severity: 'info',
        title: `${loan.lender}: a one-time extra payment of ${formatINR(amount)} shortens the loan by ${result.monthsSaved} months`,
        detail: `Paying 6 EMIs' worth (${formatINR(amount)}) at once, with the EMI kept at ${formatINR(result.newEmi)}, removes ${result.monthsSaved} of the ${remaining} remaining months and ${formatINR(result.interestSaved)} of interest.`,
        transactionIds: loan.emiTransactionIds,
      });
    }
  }
  return out;
}

function cardInsights(statements: ParsedStatement[], asOf: IsoDate): Insight[] {
  const out: Insight[] = [];
  for (const s of latestCardStatements(statements)) {
    const c = s.card as NonNullable<ParsedStatement['card']>;
    const days = diffDays(asOf, c.dueDate);
    const name = `${s.account.institution} card`;
    if (c.totalDue > 0 && days >= 0 && days <= 7) {
      out.push({
        id: `card_due_soon-${s.account.id}`,
        kind: 'card_due_soon',
        severity: 'act',
        title: `${name} payment of ${formatINR(c.totalDue)} is due on ${c.dueDate}`,
        detail: `${days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`}. Total due ${formatINR(c.totalDue)}; minimum due ${formatINR(c.minimumDue)}.`,
        transactionIds: [],
        action: { label: 'Pay card bill', kind: 'pay' },
      });
    }
    const limit = s.account.creditLimit;
    if (limit && c.totalDue * 10 > limit * 3) {
      const pct = Math.round((c.totalDue * 1000) / limit) / 10;
      out.push({
        id: `high_utilisation-${s.account.id}`,
        kind: 'high_utilisation',
        severity: 'warn',
        title: `${name} balance is ${pct}% of its ${formatINR(limit)} limit`,
        detail: `Total due ${formatINR(c.totalDue)} against a limit of ${formatINR(limit)}. 30% of the limit is ${formatINR(Math.round(limit * 0.3))}.`,
        transactionIds: [],
      });
    }
  }
  return out;
}

function transactionInsights(txns: Transaction[], recurring: RecurringPayment[]): Insight[] {
  const out: Insight[] = [];
  const debits = txns.filter((t) => t.direction === 'debit');
  const recurringIds = new Set(recurring.flatMap((r) => r.occurrences));
  const recurringPayees = new Set(recurring.map((r) => r.merchant.trim().toLowerCase()));

  const firstSeen = new Map<string, Transaction>();
  for (const t of [...debits].sort((a, b) => compareIso(a.date, b.date))) {
    const key = payeeKey(t);
    if (key && !firstSeen.has(key)) firstSeen.set(key, t);
  }
  for (const [key, t] of firstSeen) {
    if (t.amount < UNKNOWN_DEBIT_MIN || (t.category && NOT_A_PAYEE.has(t.category)) || recurringIds.has(t.id) || recurringPayees.has(key.toLowerCase())) continue;
    const who = t.merchant ?? key;
    out.push({
      id: `unknown_debit-${t.id}`,
      kind: 'unknown_debit',
      severity: 'warn',
      title: `First payment to ${who}: ${formatINR(t.amount)}`,
      detail: `${formatINR(t.amount)} was paid to ${who} on ${t.date}. There is no earlier payment to this payee in the statements provided.`,
      transactionIds: [t.id],
      action: { label: 'Review payment', kind: 'review' },
    });
  }

  const same = new Map<string, Transaction[]>();
  for (const t of debits) {
    if (t.category && NOT_A_PURCHASE.has(t.category)) continue;
    const key = `${t.accountId}|${payeeKey(t)}|${t.amount}|${t.date}`;
    same.set(key, [...(same.get(key) ?? []), t]);
  }
  for (const rows of same.values()) {
    if (rows.length < 2) continue;
    const first = rows[0] as Transaction;
    const extra = first.amount * (rows.length - 1);
    const who = first.merchant ?? payeeKey(first);
    out.push({
      id: `duplicate_charge-${first.id}`,
      kind: 'duplicate_charge',
      severity: 'warn',
      title: `${rows.length} identical charges of ${formatINR(first.amount)} at ${who} on ${first.date}`,
      detail: `${rows.length} debits with the same merchant, amount and date. The extra ${rows.length - 1} come to ${formatINR(extra)}.`,
      annualImpact: extra,
      transactionIds: rows.map((t) => t.id),
      action: { label: 'Review charges', kind: 'review' },
    });
  }
  return out;
}

function cashInsights(ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  const { statements, txns, asOf, avgMonthlySpend, recurring, loans } = ctx;

  const months = new Set(txns.map((t) => t.date.slice(0, 7)));
  if (months.size >= 3 && avgMonthlySpend > 0) {
    const perAccount = new Map<string, number[]>();
    for (const s of statements) {
      if ((s.account.kind === 'savings' || s.account.kind === 'current') && s.closingBalance !== undefined) {
        perAccount.set(s.account.id, [...(perAccount.get(s.account.id) ?? []), s.closingBalance]);
      }
    }
    const avgBalance = Math.round([...perAccount.values()].reduce((sum, b) => sum + b.reduce((x, y) => x + y, 0) / b.length, 0));
    if (perAccount.size && avgBalance > avgMonthlySpend * 6) {
      const ratio = Math.round((avgBalance * 10) / avgMonthlySpend) / 10;
      out.push({
        id: 'idle_cash',
        kind: 'idle_cash',
        severity: 'info',
        title: `Savings balance averages ${formatINR(avgBalance)}, about ${ratio} months of spending`,
        detail: `Average closing balance across savings and current accounts is ${formatINR(avgBalance)}. Average monthly spend is ${formatINR(avgMonthlySpend)}, so the balance covers ${ratio} months.`,
        transactionIds: [],
      });
    }
  }

  const liquid = liquidBalance(statements);
  const upcoming = buildUpcoming(recurring, statements, loans, asOf);
  const due = upcoming.reduce((s, u) => s + u.amount, 0);
  if (liquid !== undefined && due > 0 && liquid < due) {
    out.push({
      id: 'low_runway',
      kind: 'low_runway',
      severity: 'act',
      title: `Balance of ${formatINR(liquid)} is below the ${formatINR(due)} due in the next 45 days`,
      detail: `Known payments over the next 45 days total ${formatINR(due)} against a savings and current balance of ${formatINR(liquid)}, a gap of ${formatINR(due - liquid)}.`,
      transactionIds: [],
    });
  }

  const horizon = addDays(asOf, 60);
  for (const r of recurring) {
    if (r.frequency !== 'yearly' || compareIso(r.nextExpectedDate, asOf) < 0 || compareIso(r.nextExpectedDate, horizon) > 0) continue;
    out.push({
      id: `lumpy_expense_ahead-${r.id}`,
      kind: 'lumpy_expense_ahead',
      severity: 'info',
      title: `${r.merchant} of ${formatINR(r.typicalAmount)} is expected around ${r.nextExpectedDate}`,
      detail: `A yearly payment of ${formatINR(r.typicalAmount)} was last made on ${r.lastDate}. Spread over 12 months it is ${formatINR(Math.round(r.typicalAmount / 12))} a month.`,
      transactionIds: r.occurrences,
    });
  }
  return out;
}

export function buildInsights(ctx: InsightContext): Insight[] {
  const { insights: dups, covered } = duplicateSubscriptions(ctx.recurring, ctx.txns);
  const insights: Insight[] = [...dups];

  for (const r of ctx.recurring) {
    if (r.kind === 'subscription' && r.possiblyForgotten && !covered.has(r.id)) {
      insights.push({
        id: `forgotten_subscription-${r.id}`,
        kind: 'forgotten_subscription',
        severity: 'warn',
        title: `${r.merchant} has charged ${formatINR(r.typicalAmount)} ${FREQ_WORD[r.frequency]} for ${r.occurrences.length} payments`,
        detail: `${r.occurrences.length} payments, the latest on ${r.lastDate}. At this rate it costs ${formatINR(r.annualCost)} a year.`,
        annualImpact: r.annualCost,
        transactionIds: r.occurrences,
        action: { label: 'Cancel', kind: 'cancel' },
      });
    }
    if (r.priceChange && r.priceChange.to > r.priceChange.from) {
      const diff = r.priceChange.to - r.priceChange.from;
      const impact = diff * periodsPerYear(r);
      insights.push({
        id: `price_increase-${r.id}`,
        kind: 'price_increase',
        severity: 'warn',
        title: `${r.merchant} went up from ${formatINR(r.priceChange.from)} to ${formatINR(r.priceChange.to)}`,
        detail: `Since ${r.priceChange.on} each ${r.frequency.replace('_', '-')} charge is ${formatINR(diff)} higher. Over a year that adds ${formatINR(impact)}.`,
        annualImpact: impact,
        transactionIds: r.occurrences,
      });
    }
  }

  insights.push(...loanInsights(ctx.loans, ctx.asOf));
  insights.push(...cardInsights(ctx.statements, ctx.asOf));
  insights.push(...transactionInsights(ctx.txns, ctx.recurring));
  insights.push(...cashInsights(ctx));
  insights.push(...ctx.fees);

  return insights.sort(
    (a, b) =>
      (b.annualImpact ?? 0) - (a.annualImpact ?? 0) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
