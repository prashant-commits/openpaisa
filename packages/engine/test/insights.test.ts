import { describe, expect, it } from 'vitest';
import { detectFees } from '../src/fees.js';
import { buildInsights, type InsightContext } from '../src/insights.js';
import { detectLoans } from '../src/loans.js';
import { detectRecurring } from '../src/recurring.js';
import type { Insight, Loan, ParsedStatement, Transaction } from '../src/types.js';
import { monthly, statement, txn } from './builders.js';

const ASOF = '2026-11-03';
const GUARDRAIL = /\b(should invest|buy|recommend|fund|policy from|switch to)\b/i;

function ctx(txns: Transaction[], extra: Partial<InsightContext> = {}, statements: ParsedStatement[] = []): InsightContext {
  const recurring = detectRecurring(txns, ASOF);
  return {
    txns,
    statements: statements.length ? statements : [statement({}, txns)],
    recurring,
    loans: detectLoans(txns, recurring),
    fees: detectFees(txns, ASOF),
    asOf: ASOF,
    avgMonthlySpend: 5000000,
    ...extra,
  };
}
const kinds = (i: Insight[]) => i.map((x) => x.kind);

const homeLoan: Loan = {
  id: 'loan-hdfc', lender: 'HDFC Ltd', kind: 'home', emi: 4339116, principal: 500000000, annualRatePct: 8.5,
  tenureMonths: 240, startDate: '2025-11-05', emiTransactionIds: ['a'], confidence: 0.6,
};

describe('subscriptions', () => {
  it('flags a forgotten subscription with its annual cost', () => {
    const t = monthly('Tiny App', 129, '2026-04-09', 7, { category: 'subscriptions' });
    const out = buildInsights(ctx(t));
    const f = out.find((i) => i.kind === 'forgotten_subscription');
    expect(f).toMatchObject({ annualImpact: 12900 * 12, action: { kind: 'cancel' } });
    expect(f?.title).toContain('₹129');
  });
  it('does not flag a healthy subscription', () => {
    expect(kinds(buildInsights(ctx(monthly('Netflix', 649, '2026-05-05', 6, { category: 'subscriptions' }))))).not.toContain('forgotten_subscription');
  });
  it('flags two video services once each, with the cheaper annual cost, and no forgotten duplicate', () => {
    const t = [...monthly('Netflix', 649, '2026-05-05', 7, { category: 'subscriptions' }), ...monthly('Hotstar', 299, '2026-05-07', 7, { category: 'subscriptions' })];
    const out = buildInsights(ctx(t));
    const dup = out.filter((i) => i.kind === 'duplicate_subscription');
    expect(dup).toHaveLength(1);
    expect(dup[0]?.annualImpact).toBe(29900 * 12);
    expect(kinds(out)).not.toContain('forgotten_subscription');
  });
  it('flags one merchant charged on two accounts', () => {
    const a = monthly('Cloud Store', 210, '2026-07-05', 4, { category: 'subscriptions' });
    const b = monthly('Cloud Store', 210, '2026-07-09', 4, { category: 'subscriptions', accountId: 'icici-cc-5678' });
    const out = buildInsights(ctx([...a, ...b]));
    expect(out.filter((i) => i.kind === 'duplicate_subscription')).toHaveLength(1);
    expect(kinds(out)).not.toContain('forgotten_subscription');
  });
  it('flags price increases with yearly impact', () => {
    const t = [...monthly('Netflix', 499, '2026-04-05', 3, { category: 'subscriptions' }), ...monthly('Netflix', 649, '2026-07-05', 4, { category: 'subscriptions' })];
    const p = buildInsights(ctx(t)).find((i) => i.kind === 'price_increase');
    expect(p?.annualImpact).toBe(15000 * 12);
    expect(p?.title).toBe('Netflix went up from ₹499 to ₹649');
  });
  it('does not flag a price decrease', () => {
    const t = [...monthly('Netflix', 649, '2026-04-05', 3, { category: 'subscriptions' }), ...monthly('Netflix', 499, '2026-07-05', 4, { category: 'subscriptions' })];
    expect(kinds(buildInsights(ctx(t)))).not.toContain('price_increase');
  });
});

describe('loans', () => {
  const loanCtx = (loan: Loan) => ctx([], { loans: [loan], asOf: '2026-11-05' });
  it('reports a rate reset as arithmetic only', () => {
    const out = buildInsights(loanCtx({ ...homeLoan, annualRatePct: 7.5 }));
    const r = out.find((i) => i.kind === 'loan_rate_reset');
    expect(r?.detail).toBe('At 7.5%, the EMI for the remaining 228 months would be ₹40,383.89. Keeping ₹43,391.16 ends the loan 31 months sooner.');
    expect(r?.action).toEqual({ label: 'Write to bank', kind: 'letter' });
    expect(r?.annualImpact).toBe((4339116 - 4038389) * 12);
  });
  it('describes a rate rise without an impact figure', () => {
    const r = buildInsights(loanCtx({ ...homeLoan, annualRatePct: 9.5 })).find((i) => i.kind === 'loan_rate_reset');
    expect(r?.detail).toContain('57 months longer');
    expect(r?.annualImpact).toBeUndefined();
  });
  it('skips the reset when the rates agree, and for loans without facts', () => {
    expect(kinds(buildInsights(loanCtx(homeLoan)))).not.toContain('loan_rate_reset');
    const bare: Loan = { id: 'l', lender: 'X', kind: 'other', emi: 100000, emiTransactionIds: [], confidence: 0.6 };
    expect(buildInsights(loanCtx(bare))).toEqual([]);
  });
  it('shows prepayment arithmetic for loans with full facts', () => {
    const p = buildInsights(loanCtx(homeLoan)).find((i) => i.kind === 'prepayment_opportunity');
    expect(p?.severity).toBe('info');
    expect(p?.detail).toMatch(/Paying 6 EMIs' worth \(₹2,60,346\.96\)/);
  });
});

describe('cards', () => {
  const card = (totalDue: number, dueDate: string, limit = 10000000) =>
    statement({ id: 'icici-cc-5678', institution: 'ICICI Bank', kind: 'credit_card', creditLimit: limit }, [], { card: { totalDue, minimumDue: 210000, dueDate } });
  it('flags a card due within 7 days', () => {
    const out = buildInsights(ctx([], {}, [card(1000000, '2026-11-08')]));
    const d = out.find((i) => i.kind === 'card_due_soon');
    expect(d).toMatchObject({ severity: 'act', action: { kind: 'pay' } });
    expect(d?.detail).toContain('Due in 5 days');
  });
  it('ignores later dues', () => {
    expect(kinds(buildInsights(ctx([], {}, [card(1000000, '2026-11-12')])))).not.toContain('card_due_soon');
  });
  it('flags utilisation above 30% only', () => {
    expect(kinds(buildInsights(ctx([], {}, [card(4200000, '2026-12-01')])))).toContain('high_utilisation');
    expect(kinds(buildInsights(ctx([], {}, [card(3000000, '2026-12-01')])))).not.toContain('high_utilisation');
    expect(buildInsights(ctx([], {}, [card(4200000, '2026-12-01')])).find((i) => i.kind === 'high_utilisation')?.title).toContain('42%');
  });
});

describe('transactions', () => {
  it('flags a first-time payee of at least ₹10,000', () => {
    const big = txn({ date: '2026-10-10', amount: 25000, merchant: 'Sunrise Interiors' });
    const small = txn({ date: '2026-10-11', amount: 9999, merchant: 'Corner Shop' });
    const out = buildInsights(ctx([big, small]));
    expect(out.filter((i) => i.kind === 'unknown_debit').map((i) => i.transactionIds[0])).toEqual([big.id]);
  });
  it('does not flag transfers or recurring payees', () => {
    const self = txn({ date: '2026-10-10', amount: 50000, merchant: 'Self', category: 'transfers' });
    const rent = monthly('Landlord', 28000, '2026-06-03', 5, { category: 'rent' });
    expect(kinds(buildInsights(ctx([self, ...rent])))).not.toContain('unknown_debit');
  });
  it('flags duplicate charges with the extra amount', () => {
    const a = txn({ date: '2026-10-10', amount: 1299, merchant: 'Gadget Shop' });
    const b = txn({ date: '2026-10-10', amount: 1299, merchant: 'Gadget Shop' });
    const d = buildInsights(ctx([a, b])).find((i) => i.kind === 'duplicate_charge');
    expect(d?.annualImpact).toBe(129900);
    expect(d?.transactionIds).toEqual([a.id, b.id]);
  });
  it('does not flag different amounts or dates', () => {
    const t = [txn({ date: '2026-10-10', amount: 100, merchant: 'S' }), txn({ date: '2026-10-11', amount: 100, merchant: 'S' }), txn({ date: '2026-10-10', amount: 101, merchant: 'S' })];
    expect(kinds(buildInsights(ctx(t)))).not.toContain('duplicate_charge');
  });
});

describe('cash', () => {
  const spread = (bal: number) => ['2026-08-31', '2026-09-30', '2026-10-31'].map((d) => txn({ date: d, amount: 1, merchant: 'x' + d })).map((t) => t);
  const sav = (closing: number, end: string) => statement({}, [], { closingBalance: closing, periodEnd: end });
  it('reports idle cash with enough history and no product named', () => {
    const t = spread(0);
    const stmts = [sav(40000000, '2026-08-31'), sav(42000000, '2026-09-30'), sav(44000000, '2026-10-31')];
    const i = buildInsights(ctx(t, { avgMonthlySpend: 5000000 }, stmts)).find((x) => x.kind === 'idle_cash');
    expect(i?.title).toBe('Savings balance averages ₹4,20,000, about 8.4 months of spending');
  });
  it('needs three months of data and a large enough balance', () => {
    const stmts = [sav(44000000, '2026-10-31')];
    expect(kinds(buildInsights(ctx([txn({ date: '2026-10-05', amount: 1, merchant: 'a' })], {}, stmts)))).not.toContain('idle_cash');
    expect(kinds(buildInsights(ctx(spread(0), {}, [sav(20000000, '2026-10-31')])))).not.toContain('idle_cash');
  });
  it('flags low runway when the balance is below the next 45 days of payments', () => {
    const t = monthly('Landlord', 28000, '2026-06-03', 5, { category: 'rent' });
    const low = buildInsights(ctx(t, {}, [sav(3000000, '2026-11-02')])).find((x) => x.kind === 'low_runway');
    expect(low?.severity).toBe('act');
    expect(kinds(buildInsights(ctx(t, {}, [sav(30000000, '2026-11-02')])))).not.toContain('low_runway');
  });
  it('flags a yearly payment due within 60 days', () => {
    const t = [txn({ date: '2024-12-20', amount: 1499, merchant: 'Annual Club' }), txn({ date: '2025-12-20', amount: 1499, merchant: 'Annual Club' })];
    const out = buildInsights(ctx(t));
    expect(out.find((i) => i.kind === 'lumpy_expense_ahead')?.title).toContain('2026-12-20');
    const far = [txn({ date: '2024-03-20', amount: 1499, merchant: 'Annual Club' }), txn({ date: '2025-03-20', amount: 1499, merchant: 'Annual Club' })];
    expect(kinds(buildInsights(ctx(far)))).not.toContain('lumpy_expense_ahead');
  });
});

describe('ordering and guardrail', () => {
  const rich = (): Insight[] => {
    const t = [
      ...monthly('Netflix', 649, '2026-05-05', 6, { category: 'subscriptions' }),
      ...monthly('Hotstar', 299, '2026-05-07', 6, { category: 'subscriptions' }),
      ...monthly('Tiny App', 129, '2026-05-09', 6, { category: 'subscriptions' }),
      txn({ date: '2026-09-10', amount: 1000, rawDescription: 'LATE PAYMENT FEE' }),
      txn({ date: '2026-09-10', amount: 180, rawDescription: 'IGST' }),
      txn({ date: '2026-10-10', amount: 25000, merchant: 'Sunrise Interiors' }),
    ];
    const card = statement({ id: 'cc', institution: 'ICICI Bank', kind: 'credit_card', creditLimit: 10000000 }, [], { card: { totalDue: 4200000, minimumDue: 210000, dueDate: '2026-11-08' } });
    return buildInsights(ctx(t, { loans: [{ ...homeLoan, annualRatePct: 7.5 }] }, [statement({}, t), card]));
  };
  it('sorts by annual impact desc, then severity', () => {
    const out = rich();
    const impact = out.map((i) => i.annualImpact ?? 0);
    expect(impact).toEqual([...impact].sort((a, b) => b - a));
    const zero = out.filter((i) => !i.annualImpact);
    const sev = zero.map((i) => ({ act: 0, warn: 1, info: 2 })[i.severity]);
    expect(sev).toEqual([...sev].sort((a, b) => a - b));
    expect(new Set(out.map((i) => i.id)).size).toBe(out.length);
  });
  it('never gives advice or names a product', () => {
    const out = rich();
    expect(out.length).toBeGreaterThan(6);
    for (const i of out) expect(`${i.title} ${i.detail}`, i.id).not.toMatch(GUARDRAIL);
  });
  it('returns nothing for no data', () => {
    expect(buildInsights(ctx([], {}, [statement({}, [])]))).toEqual([]);
  });
});

describe('integration regressions', () => {
  it('B-r1-02: merchant-less recurring payee is not an unknown debit', () => {
    const t = monthly('', 43391.16, '2026-05-05', 6, { merchant: undefined, category: undefined, channel: 'nach' }).map((x, i) => ({ ...x, rawDescription: `NACH/HDFCBANKLTD/HOME LOAN ${i}` }));
    expect(kinds(buildInsights(ctx(t)))).not.toContain('unknown_debit');
  });

  it('B-r1-01: overlapping video pair gives only duplicate_subscription', () => {
    const t = [...monthly('Netflix', 649, '2026-05-05', 6, { category: 'subscriptions' }), ...monthly('Hotstar', 299, '2026-08-07', 3, { category: 'subscriptions' })];
    const k = kinds(buildInsights(ctx(t)));
    expect(k).toContain('duplicate_subscription');
    expect(k).not.toContain('forgotten_subscription');
  });

  it('B-int-01: duplicate_charge is per account and skips non-purchases', () => {
    const emiA = txn({ date: '2026-10-05', amount: 18500, merchant: 'Bajaj Finance', category: 'emi' });
    const emiB = txn({ date: '2026-10-05', amount: 18500, merchant: 'Bajaj Finance', category: 'emi', accountId: 'icici-sav-5678' });
    const crossAcct = [txn({ date: '2026-10-05', amount: 700, merchant: 'Swiggy' }), txn({ date: '2026-10-05', amount: 700, merchant: 'Swiggy', accountId: 'icici-sav-5678' })];
    const atm = [txn({ date: '2026-09-15', amount: 10000, merchant: 'ATM', category: 'cash_withdrawal' }), txn({ date: '2026-09-15', amount: 10000, merchant: 'ATM', category: 'cash_withdrawal' })];
    expect(kinds(buildInsights(ctx([emiA, emiB, ...crossAcct, ...atm])))).not.toContain('duplicate_charge');
    const same = [txn({ date: '2026-10-05', amount: 450, merchant: 'Swiggy' }), txn({ date: '2026-10-05', amount: 450, merchant: 'Swiggy' })];
    expect(kinds(buildInsights(ctx(same))).filter((k) => k === 'duplicate_charge')).toHaveLength(1);
  });

  it('B-int-02: no forgotten_subscription for EMIs on two accounts', () => {
    const a = monthly('Bajaj Finance', 18500, '2026-07-05', 4, { category: 'emi' });
    const b = monthly('Bajaj Finance', 18500, '2026-07-09', 4, { category: 'emi', accountId: 'icici-sav-5678' });
    expect(kinds(buildInsights(ctx([...a, ...b])))).not.toContain('forgotten_subscription');
  });

  it('B-int-04: unmatched savings-side card bill payments are not unknown debits', () => {
    const t = monthly('Card payment', 12000, '2026-07-05', 3, { category: 'other' }).map((x) => ({ ...x, rawDescription: 'CREDIT CARD PAYMENT-XXXXXX5678' }));
    expect(kinds(buildInsights(ctx(t)))).not.toContain('unknown_debit');
    const cred = monthly('Cred', 32000, '2026-07-05', 1, { category: 'other' }).map((x) => ({ ...x, rawDescription: 'UPI-CRED CLUB-cred.club@axisb-UTIB0000100-412345678901-Payment' }));
    expect(kinds(buildInsights(ctx(cred)))).not.toContain('unknown_debit');
  });
});
