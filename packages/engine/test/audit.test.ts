import { describe, expect, it } from 'vitest';
import { runAudit } from '../src/audit.js';
import * as engine from '../src/index.js';
import type { AuditInput } from '../src/types.js';
import { household, monthly, resetBuilders, statement, txn } from './builders.js';

const GUARDRAIL = /\b(should invest|buy|recommend|fund|policy from|switch to)\b/i;

describe('runAudit: empty and thin input', () => {
  it('returns an empty report for no statements', () => {
    const r = runAudit({ statements: [], asOf: '2026-11-03' });
    expect(r).toEqual({
      asOf: '2026-11-03', accounts: [], transactions: [], recurring: [], loans: [], insights: [],
      headline: { annualLeak: 0, recurringAnnual: 0, emiMonthly: 0 }, flows: [], upcoming: [], cards: [],
    });
  });

  it('handles a statement with no transactions', () => {
    const r = runAudit({ statements: [statement({}, [])], asOf: '2026-11-03' });
    expect(r.accounts).toHaveLength(1);
    expect(r.insights).toEqual([]);
  });

  it('one month of data: no recurring, no idle cash, one flow, no throw', () => {
    resetBuilders();
    const t = [
      txn({ date: '2026-10-01', amount: 120000, direction: 'credit', category: 'salary', merchant: 'Acme' }),
      txn({ date: '2026-10-05', amount: 649, category: 'subscriptions', merchant: 'Netflix' }),
      txn({ date: '2026-10-09', amount: 28000, category: 'rent', merchant: 'Landlord' }),
    ];
    const r = runAudit({ statements: [statement({}, t, { closingBalance: 99999999, periodEnd: '2026-10-31' })], asOf: '2026-11-03' });
    expect(r.recurring).toEqual([]);
    expect(r.insights.map((i) => i.kind)).not.toContain('idle_cash');
    expect(r.flows).toHaveLength(1);
    expect(r.headline.recurringAnnual).toBe(0);
  });

  it('works when the user supplies a loan the statements do not show', () => {
    const r = runAudit({
      statements: [],
      asOf: '2026-11-03',
      loans: [{ lender: 'Axis Fin', principal: 100000000, annualRatePct: 10, tenureMonths: 60, startDate: '2026-01-15' }],
    });
    expect(r.loans).toHaveLength(1);
    expect(r.loans[0]?.emi).toBe(engine.emiFor(100000000, 10, 60));
    expect(r.loans[0]?.outstanding).toBeGreaterThan(0);
    expect(r.headline.emiMonthly).toBe(r.loans[0]?.emi);
  });

  it('user loan fields win over detected ones', () => {
    const t = monthly('HDFC Ltd', 43391.16, '2026-06-05', 5, { channel: 'nach', category: 'emi', rawDescription: 'NACH HOME LOAN' });
    const r = runAudit({ statements: [statement({}, t)], asOf: '2026-11-03', loans: [{ lender: 'hdfc ltd', kind: 'car', isFloating: true }] });
    expect(r.loans).toHaveLength(1);
    expect(r.loans[0]).toMatchObject({ kind: 'car', isFloating: true, emi: 4339116 });
  });
});

describe('B-r2-03 loan merge by EMI', () => {
  it('merges a user loan with a detected loan of a different lender name', () => {
    const t = monthly('HDFC Bank', 43391.16, '2026-06-05', 6, { channel: 'nach', category: 'emi', rawDescription: 'NACH HOME LOAN' });
    const r = runAudit({ statements: [statement({}, t)], asOf: '2026-11-03', loans: [{ lender: 'HDFC Ltd', principal: 500000000, annualRatePct: 8.5, tenureMonths: 240, startDate: '2026-05-01', emi: 4339116 }] });
    expect(r.loans).toHaveLength(1);
    expect(r.loans[0]?.lender).toBe('HDFC Ltd');
    expect(r.headline.emiMonthly).toBe(4339116);
    const emis = r.upcoming.filter((u) => u.amount === 4339116);
    expect(new Set(emis.map((u) => u.date)).size).toBe(emis.length);
  });
});

describe('runAudit: six-month household', () => {
  const input = household();
  const r = runAudit(input);

  it('finds the recurring payments and none of the one-offs', () => {
    const names = r.recurring.map((x) => x.merchant);
    expect(names).toEqual(expect.arrayContaining(['Netflix', 'Hotstar', 'Landlord Mehta', 'HDFC Ltd', 'Tiny App']));
    expect(names).not.toContain('Swiggy');
    expect(names).not.toContain('Blinkit');
    expect(names).not.toContain('Acme Pvt Ltd');
    expect(names).not.toContain('ICICI Card');
    expect(r.recurring.find((x) => x.merchant === 'HDFC Ltd')?.kind).toBe('emi');
    expect(r.recurring.find((x) => x.merchant === 'Landlord Mehta')?.kind).toBe('rent');
  });

  it('raises the expected insights', () => {
    const kinds = r.insights.map((i) => i.kind);
    for (const k of ['late_fee', 'forex_markup', 'duplicate_subscription', 'card_due_soon', 'high_utilisation', 'forgotten_subscription', 'prepayment_opportunity'] as const) {
      expect(kinds, k).toContain(k);
    }
    expect(kinds).not.toContain('unknown_debit');
    expect(kinds).not.toContain('idle_cash');
    expect(kinds).not.toContain('low_runway');
    expect(r.insights.find((i) => i.kind === 'late_fee')?.title).toBe('You paid ₹1,180 in late fees');
  });

  it('merges the loan facts and computes the headline', () => {
    expect(r.loans).toHaveLength(1);
    expect(r.loans[0]).toMatchObject({ lender: 'HDFC Ltd', emi: 4339116, principal: 500000000, outstanding: 490910689 });
    expect(r.headline.emiMonthly).toBe(4339116);
    expect(r.headline.recurringAnnual).toBe(r.recurring.reduce((s, x) => s + x.annualCost, 0));
    const leakKinds = new Set(['forgotten_subscription', 'duplicate_subscription', 'price_increase', 'fee_paid', 'late_fee', 'card_interest', 'forex_markup', 'duplicate_charge']);
    expect(r.headline.annualLeak).toBe(r.insights.filter((i) => leakKinds.has(i.kind)).reduce((s, i) => s + (i.annualImpact ?? 0), 0));
    expect(r.headline.annualLeak).toBeGreaterThan(0);
  });

  it('summarises the card', () => {
    expect(r.cards).toEqual([
      { accountId: 'icici-cc-5678', totalDue: 4200000, minimumDue: 210000, dueDate: '2026-11-08', statementDate: '2026-10-24', creditLimit: 10000000, utilisationPct: 42 },
    ]);
  });

  it('sorts insights by impact then severity', () => {
    const impact = r.insights.map((i) => i.annualImpact ?? 0);
    expect(impact).toEqual([...impact].sort((a, b) => b - a));
  });

  it('builds salary-cycle flows, upcoming outflows and safe-to-spend', () => {
    expect(r.flows).toHaveLength(6);
    expect(r.flows[0]).toMatchObject({ cycleStart: '2026-05-01', income: 12000000 });
    expect(r.upcoming.length).toBeGreaterThan(0);
    expect(r.upcoming.every((u) => u.date >= '2026-11-03' && u.date <= '2026-12-18')).toBe(true);
    expect(r.upcoming.some((u) => u.source === 'card_due' && u.amount === 4200000)).toBe(true);
    const before = r.upcoming.filter((u) => u.date < '2026-12-01').reduce((s, u) => s + u.amount, 0);
    expect(r.safeToSpend).toEqual({ untilDate: '2026-12-01', amount: 25000000 - before });
  });

  it('has no insight that gives advice or names a product', () => {
    for (const i of r.insights) expect(`${i.title} ${i.detail}`, i.id).not.toMatch(GUARDRAIL);
  });

  it('is pure: the same input gives deep-equal output, and the input is untouched', () => {
    const snapshot = JSON.stringify(input);
    expect(runAudit(input)).toEqual(r);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(runAudit(household())).toEqual(runAudit(household()));
  });

  it('is exported from the package index', () => {
    for (const name of ['runAudit', 'detectRecurring', 'emiFor', 'amortise', 'outstandingAt', 'prepay', 'solveRate', 'rateResetCheck', 'detectLoans', 'detectFees', 'buildFlows', 'buildUpcoming', 'safeToSpend', 'buildInsights', 'addMonths', 'addDays', 'diffDays']) {
      expect(typeof (engine as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});

describe('runAudit: input handling', () => {
  it('honours an explicit salary day', () => {
    const base = household();
    const withDay: AuditInput = { ...base, salaryDay: 25 };
    expect(runAudit(withDay).safeToSpend?.untilDate).toBe('2026-11-25');
  });
});
