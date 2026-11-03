import { describe, expect, it } from 'vitest';
import type { InsightKind } from '@openpaisa/engine';
import { sampleReport as r } from '../src/demo/sampleReport';
import { cardsSummary, searchTransactions, spendByCategory } from '../src/lib/selectors';

const LEAK: InsightKind[] = [
  'forgotten_subscription', 'duplicate_subscription', 'price_increase', 'fee_paid',
  'late_fee', 'card_interest', 'forex_markup', 'duplicate_charge',
];
const sev = { act: 0, warn: 1, info: 2 } as const;

describe('sampleReport', () => {
  it('is large and varied enough', () => {
    expect(r.transactions.length).toBeGreaterThanOrEqual(120);
    expect(r.recurring).toHaveLength(6);
    expect(r.insights.length).toBeGreaterThanOrEqual(8);
    expect(r.flows).toHaveLength(6);
    expect(r.transactions.every((t) => Number.isInteger(t.amount) && t.amount > 0)).toBe(true);
  });
  it('sorts insights by annualImpact desc then severity', () => {
    for (let i = 1; i < r.insights.length; i++) {
      const a = r.insights[i - 1]!, b = r.insights[i]!;
      const ia = a.annualImpact ?? 0, ib = b.annualImpact ?? 0;
      expect(ia > ib || (ia === ib && sev[a.severity] <= sev[b.severity])).toBe(true);
    }
  });
  it('headline.annualLeak equals the sum of leak-kind impacts', () => {
    const sum = r.insights.filter((i) => LEAK.includes(i.kind)).reduce((s, i) => s + (i.annualImpact ?? 0), 0);
    expect(r.headline.annualLeak).toBe(sum);
    expect(sum).toBeGreaterThan(0);
  });
  it('insight transaction ids exist', () => {
    const ids = new Set(r.transactions.map((t) => t.id));
    for (const i of r.insights) for (const id of i.transactionIds) expect(ids.has(id)).toBe(true);
  });
});

describe('spendByCategory', () => {
  it('ranks the latest cycle by hand-computed totals', () => {
    const rows = spendByCategory(r, '2026-10-01');
    expect(rows[0]).toMatchObject({ category: 'emi', amount: 4_339_116, avg3: 4_339_116 });
    expect(rows[1]).toMatchObject({ category: 'rent', amount: 2_800_000 });
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.amount).toBeGreaterThanOrEqual(rows[i]!.amount);
    expect(rows.find((x) => x.category === 'card_payment')).toBeUndefined();
  });
  it('has no average for the first cycle', () => {
    expect(spendByCategory(r, '2026-05-01')[0]!.avg3).toBe(0);
  });
});

describe('searchTransactions', () => {
  it('finds Swiggy rows case-insensitively', () => {
    const res = searchTransactions(r, 'swig', 0);
    expect(res.total).toBe(r.transactions.filter((t) => t.merchant === 'Swiggy').length);
    expect(res.rows.every((t) => t.merchant === 'Swiggy')).toBe(true);
  });
  it('paginates at 50', () => {
    const p0 = searchTransactions(r, '', 0);
    const p1 = searchTransactions(r, '', 1);
    expect(p0.rows).toHaveLength(50);
    expect(p1.rows.length).toBeGreaterThan(0);
    expect(p0.total).toBe(r.transactions.length);
    expect(p0.rows.some((t) => p1.rows.includes(t))).toBe(false);
    expect(searchTransactions(r, 'swig', 1, 10).rows).toHaveLength(10);
  });
});

describe('cardsSummary', () => {
  it('joins the account and shows 42% utilisation', () => {
    const [c] = cardsSummary(r);
    expect(c!.account.id).toBe('icici-cc-5678');
    expect(c!.totalDue).toBe(4_200_000);
    expect(c!.utilisationPct).toBe(42);
  });
});
