import { describe, expect, it } from 'vitest';
import { amortise, detectLoans, emiFor, outstandingAt, prepay, rateResetCheck, solveRate } from '../src/loans.js';
import { detectRecurring } from '../src/recurring.js';
import type { Loan } from '../src/types.js';
import { monthly, txn } from './builders.js';

const loan: Loan = {
  id: 'loan-hdfc', lender: 'HDFC Ltd', kind: 'home', emi: 4339116, principal: 500000000,
  annualRatePct: 8.5, tenureMonths: 240, startDate: '2025-11-05', emiTransactionIds: [], confidence: 0.6,
};
const ASOF = '2026-11-05';

describe('emiFor', () => {
  it('matches the known value', () => {
    expect(emiFor(500000000, 8.5, 240)).toBe(4339116);
  });
  it('handles a zero rate', () => {
    expect(emiFor(120000, 0, 12)).toBe(10000);
  });
});

describe('amortise', () => {
  const rows = amortise(loan, ASOF);
  it('builds the full schedule', () => {
    expect(rows).toHaveLength(240);
    expect(rows[0]?.interest).toBe(Math.round((500000000 * 8.5) / 1200));
    expect(rows[0]?.interest).toBe(3541667);
    expect(rows[0]?.date).toBe('2025-12-05');
    expect(rows[239]?.outstanding).toBe(0);
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBe(500000000);
  });
  it('is internally consistent each month', () => {
    for (const r of rows) expect(r.emi).toBe(r.interest + r.principal);
  });
  it('returns [] with missing facts', () => {
    expect(amortise({ ...loan, principal: undefined }, ASOF)).toEqual([]);
    expect(amortise({ ...loan, annualRatePct: undefined }, ASOF)).toEqual([]);
    expect(amortise({ ...loan, tenureMonths: undefined }, ASOF)).toEqual([]);
    expect(amortise({ ...loan, startDate: undefined }, ASOF)).toEqual([]);
  });
});

describe('outstandingAt', () => {
  it('counts EMIs dated on or before asOf', () => {
    expect(outstandingAt(loan, ASOF)).toBe(490048857);
    expect(outstandingAt(loan, '2025-11-05')).toBe(500000000);
    expect(outstandingAt(loan, '2025-12-04')).toBe(500000000);
    expect(outstandingAt(loan, '2045-12-05')).toBe(0);
  });
});

describe('prepay', () => {
  it('reduce_tenure keeps the EMI and saves months', () => {
    const r = prepay(loan, 50000000, 'reduce_tenure', ASOF);
    expect(r.monthsSaved).toBe(48);
    expect(r.newEmi).toBe(4339116);
    expect(Math.abs(r.interestSaved - 160369091)).toBeLessThanOrEqual(10000);
    expect(r.mode).toBe('reduce_tenure');
    expect(r.prepayment).toBe(50000000);
  });
  it('reduce_emi keeps tenure and cuts the EMI', () => {
    const r = prepay(loan, 50000000, 'reduce_emi', ASOF);
    expect(r.monthsSaved).toBe(0);
    expect(r.newEmi).toBe(emiFor(490048857 - 50000000, 8.5, 228));
    expect(r.interestSaved).toBeGreaterThan(0);
  });
  it('a prepayment covering the balance clears the loan', () => {
    const r = prepay(loan, 600000000, 'reduce_tenure', ASOF);
    expect(r.monthsSaved).toBe(228);
    expect(r.newEmi).toBe(0);
  });
  it('throws a clear error with missing facts', () => {
    expect(() => prepay({ ...loan, principal: undefined }, 1000, 'reduce_tenure', ASOF)).toThrow(
      'loan needs principal, annualRatePct, tenureMonths and startDate',
    );
  });
});

describe('solveRate', () => {
  it('recovers the rate', () => {
    expect(solveRate(500000000, 4339116, 240)).toBe(8.5);
    expect(solveRate(120000, 10000, 12)).toBe(0);
    expect(solveRate(100000000, emiFor(100000000, 11.25, 60), 60)).toBe(11.25);
  });
});

describe('rateResetCheck', () => {
  it('a rate rise stretches the tenure', () => {
    expect(rateResetCheck(loan, 9.5, ASOF)).toEqual({ tenureExtendedMonths: 57, emiIfReduced: 4649778 });
  });
  it('a rate cut shortens it (negative)', () => {
    expect(rateResetCheck(loan, 7.5, ASOF)).toEqual({ tenureExtendedMonths: -31, emiIfReduced: 4038389 });
  });
  it('is null when the rate is unchanged', () => {
    expect(rateResetCheck(loan, 8.5, ASOF)).toBeNull();
  });
  it('is null without loan facts', () => {
    expect(rateResetCheck({ ...loan, principal: undefined }, 9.5, ASOF)).toBeNull();
  });
  it('caps when the EMI no longer covers interest', () => {
    const r = rateResetCheck(loan, 60, ASOF);
    expect(r?.tenureExtendedMonths).toBe(1200 - 228);
  });
});

describe('detectLoans', () => {
  it('finds a home loan from NACH debits', () => {
    const t = monthly('HDFC Ltd', 43391.16, '2026-05-05', 6, { channel: 'nach', category: 'emi', rawDescription: 'NACH/HDFCBANKLTD/HOME LOAN' });
    const found = detectLoans(t, detectRecurring(t, '2026-11-03'));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'home', emi: 4339116, lender: 'HDFC Ltd', confidence: 0.6 });
    expect(found[0]?.emiTransactionIds).toHaveLength(6);
  });
  it('finds a NACH loan debit the categoriser left as other', () => {
    const t = monthly('Axis Fin', 12500, '2026-06-02', 5, { channel: 'nach', category: 'shopping', rawDescription: 'NACH AXIS PERSONAL LOAN EMI' });
    const found = detectLoans(t, detectRecurring(t, '2026-11-03'));
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('personal');
  });
  it('classifies card EMI and ignores non-loans', () => {
    const t = monthly('ICICI Bank', 3000, '2026-06-02', 5, { category: 'emi', rawDescription: 'EMI 2/12 PHONE' });
    expect(detectLoans(t, detectRecurring(t, '2026-11-03'))[0]?.kind).toBe('card_emi');
    const n = monthly('Netflix', 649, '2026-06-02', 5, { category: 'subscriptions' });
    expect(detectLoans(n, detectRecurring(n, '2026-11-03'))).toEqual([]);
    expect(detectLoans([txn({ date: '2026-06-02', amount: 10 })], [])).toEqual([]);
  });
});
