import type { RecurringPayment } from '../src/types.js';
import { describe, expect, it } from 'vitest';
import { addMonths } from '../src/dates.js';
import { subscriptionGroup, detectRecurring } from '../src/recurring.js';
import { monthly, txn } from './builders.js';

const ASOF = '2026-11-03';

describe('detectRecurring', () => {
  it('detects a monthly subscription with annual cost and next date', () => {
    const r = detectRecurring(monthly('Netflix', 649, '2026-05-05', 6, { category: 'subscriptions' }), ASOF);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ merchant: 'Netflix', frequency: 'monthly', typicalAmount: 64900, annualCost: 778800, kind: 'subscription', lastDate: '2026-10-05', nextExpectedDate: '2026-11-05' });
    expect(r[0]?.occurrences).toHaveLength(6);
    expect(r[0]?.id).toBe('rec-netflix-monthly');
  });

  it('clusters month-end billing (31st, 28th, 30th) as monthly and clamps next date', () => {
    const t = [
      txn({ date: '2026-01-31', amount: 999, merchant: 'Gym' }),
      txn({ date: '2026-02-28', amount: 999, merchant: 'Gym' }),
      txn({ date: '2026-03-31', amount: 999, merchant: 'Gym' }),
      txn({ date: '2026-04-30', amount: 999, merchant: 'Gym' }),
    ];
    const r = detectRecurring(t, '2026-05-10');
    expect(r[0]?.frequency).toBe('monthly');
    expect(r[0]?.nextExpectedDate).toBe('2026-05-31');
    const short = detectRecurring(t.slice(0, 3), '2026-04-05');
    expect(short[0]?.nextExpectedDate).toBe('2026-04-30');
  });

  it('next expected after 2026-01-31 is 2026-02-28', () => {
    const t = [
      txn({ date: '2025-11-30', amount: 500, merchant: 'Club' }),
      txn({ date: '2025-12-31', amount: 500, merchant: 'Club' }),
      txn({ date: '2026-01-31', amount: 500, merchant: 'Club' }),
    ];
    expect(detectRecurring(t, '2026-02-05')[0]?.nextExpectedDate).toBe('2026-02-28');
  });

  it('merges a price change into one series and records it', () => {
    const t = [...monthly('Netflix', 499, '2026-04-05', 3), ...monthly('Netflix', 649, '2026-07-05', 3)];
    const r = detectRecurring(t, ASOF);
    expect(r).toHaveLength(1);
    expect(r[0]?.priceChange).toEqual({ from: 49900, to: 64900, on: '2026-07-05' });
    expect(r[0]?.typicalAmount).toBe(64900);
  });

  it('splits interleaved plans of one merchant', () => {
    const t = [...monthly('Cloud Store', 130, '2026-05-02', 6), ...monthly('Cloud Store', 650, '2026-05-12', 6)];
    const r = detectRecurring(t, ASOF);
    expect(r).toHaveLength(2);
    expect(new Set(r.map((x) => x.id)).size).toBe(2);
  });

  it('treats varying utility bills as recurring but random groceries as not', () => {
    const amounts = [1800, 2250, 1500, 2100, 1650, 2000];
    const bill = amounts.map((a, i) => txn({ date: addMonths('2026-05-12', i), amount: a, merchant: 'BESCOM', category: 'utilities' }));
    const u = detectRecurring(bill, ASOF);
    expect(u).toHaveLength(1);
    expect(u[0]?.kind).toBe('utility');
    const rand = [320, 1450, 610, 90, 2200, 780].map((a, i) => txn({ date: `2026-0${i + 4}-${10 + i}`, amount: a, merchant: 'Local Mart', category: 'groceries' }));
    expect(detectRecurring(rand, ASOF)).toEqual([]);
  });

  it('detects a yearly payment from two occurrences', () => {
    const t = [txn({ date: '2025-10-20', amount: 1499, merchant: 'Amazon Prime' }), txn({ date: '2026-10-20', amount: 1499, merchant: 'Amazon Prime' })];
    const r = detectRecurring(t, ASOF);
    expect(r[0]).toMatchObject({ frequency: 'yearly', annualCost: 149900, nextExpectedDate: '2027-10-20' });
  });

  it('needs at least three monthly occurrences', () => {
    expect(detectRecurring(monthly('Netflix', 649, '2026-09-05', 2), ASOF)).toEqual([]);
    expect(detectRecurring([], ASOF)).toEqual([]);
  });

  it('ignores credits such as salary', () => {
    const sal = monthly('Acme Pvt Ltd', 120000, '2026-05-01', 6, { direction: 'credit', category: 'salary' });
    expect(detectRecurring(sal, ASOF)).toEqual([]);
  });

  it('ignores lapsed series', () => {
    expect(detectRecurring(monthly('Old App', 199, '2025-01-05', 5), ASOF)).toEqual([]);
  });

  it('classifies kind from category', () => {
    const cases: [string, RecurringPayment['kind']][] = [['emi', 'emi'], ['investments', 'sip'], ['insurance', 'insurance'], ['rent', 'rent'], ['telecom', 'utility'], ['other', 'other']];
    for (const [cat, kind] of cases) {
      const r = detectRecurring(monthly(`M-${cat}`, 1000, '2026-05-05', 5, { category: cat as never }), ASOF);
      expect(r[0]?.kind).toBe(kind);
    }
  });

  it('falls back to keywords when no category is set', () => {
    const r = detectRecurring(monthly('Housing Fin', 25000, '2026-05-05', 5, { rawDescription: 'NACH HOME LOAN EMI' }), ASOF);
    expect(r[0]?.kind).toBe('emi');
  });

  it('falls back to the description when merchant is missing', () => {
    const t = [1, 2, 3, 4].map((i) => txn({ date: `2026-0${i + 5}-07`, amount: 299, rawDescription: `UPI/1234567890${i}/GYM FITNESS/x@y` }));
    const r = detectRecurring(t.map((x) => ({ ...x, merchant: undefined })), '2026-10-01');
    expect(r).toHaveLength(1);
  });

  it('flags a small long-running subscription as possibly forgotten', () => {
    const r = detectRecurring(monthly('Tiny App', 129, '2026-04-09', 7, { category: 'subscriptions' }), ASOF);
    expect(r[0]?.possiblyForgotten).toBe(true);
    const big = detectRecurring(monthly('Netflix', 649, '2026-05-05', 6, { category: 'subscriptions' }), ASOF);
    expect(big[0]?.possiblyForgotten).toBe(false);
  });

  it('flags overlapping video services', () => {
    const t = [...monthly('Netflix', 649, '2026-08-05', 3, { category: 'subscriptions' }), ...monthly('Hotstar', 299, '2026-08-07', 3, { category: 'subscriptions' })];
    expect(subscriptionGroup('Netflix')).toBe('video streaming');
    expect(subscriptionGroup('Swiggy')).toBeUndefined();
    const r = detectRecurring(t, ASOF);
    expect(r.length).toBe(2);
    expect(r.map((x) => x.possiblyForgotten)).toEqual([true, true]);
  });

  it('does not group unrelated merchants by substring', () => {
    expect(subscriptionGroup('Mahabodhi Yoga Studio')).toBeUndefined();
    expect(subscriptionGroup('Shbo Stores')).toBeUndefined();
    expect(subscriptionGroup('Aha')).toBe('video streaming');
    expect(subscriptionGroup('Disney+ Hotstar')).toBe('video streaming');
  });

  it('ignores a single trailing out-of-band charge', () => {
    const t = [...monthly('Airtel', 299, '2026-05-10', 5, { category: 'telecom' }), txn({ date: '2026-10-10', amount: 3599, merchant: 'Airtel', category: 'telecom' })];
    const r = detectRecurring(t, ASOF);
    expect(r).toHaveLength(1);
    expect(r[0]?.typicalAmount).toBe(29900);
    expect(r[0]?.priceChange).toBeUndefined();
  });

  it('only flags possiblyForgotten on subscriptions', () => {
    const a = monthly('Bajaj Finance', 18500, '2026-07-05', 4, { category: 'emi' });
    const b = monthly('Bajaj Finance', 18500, '2026-07-09', 4, { category: 'emi', accountId: 'icici-sav-5678' });
    const r = detectRecurring([...a, ...b], ASOF);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => !x.possiblyForgotten)).toBe(true);
  });

  it('excludes unmatched credit-card bill payments but keeps debit-card purchases', () => {
    const bill = monthly('', 11200, '2026-07-05', 4, { category: 'other', merchant: undefined, channel: 'neft' }).map((t, i) => ({ ...t, rawDescription: `CREDIT CARD PAYMENT-XXXXXX5678` }));
    expect(detectRecurring(bill, ASOF)).toHaveLength(0);
    const debit = monthly('', 11200, '2026-07-05', 4, { category: 'other', merchant: undefined }).map((t) => ({ ...t, rawDescription: `DEBIT CARD PURCHASE GYM XYZ` }));
    expect(detectRecurring(debit, ASOF)).toHaveLength(1);
  });

  it('flags one merchant charged on two accounts in the same month', () => {
    const a = monthly('Cloud Store', 210, '2026-07-05', 4, { category: 'subscriptions' });
    const b = monthly('Cloud Store', 210, '2026-07-09', 4, { category: 'subscriptions', accountId: 'icici-cc-5678' });
    const r = detectRecurring([...a, ...b], ASOF);
    expect(r).toHaveLength(1);
    expect(r[0]?.possiblyForgotten).toBe(true);
  });

  it('sorts by annual cost descending', () => {
    const t = [...monthly('Small', 100, '2026-05-05', 5), ...monthly('Big', 5000, '2026-05-06', 5)];
    expect(detectRecurring(t, ASOF).map((r) => r.merchant)).toEqual(['Big', 'Small']);
  });

  it('B-r2-01: a single post-change charge at a plausible new price is a price change', () => {
    const t = [...monthly('Netflix', 499, '2026-05-05', 5, { category: 'subscriptions' }), txn({ date: '2026-10-05', amount: 649, merchant: 'Netflix', category: 'subscriptions' })];
    const r = detectRecurring(t, ASOF);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ typicalAmount: 64900, lastDate: '2026-10-05', nextExpectedDate: '2026-11-05', priceChange: { from: 49900, to: 64900, on: '2026-10-05' } });
  });

  it('B-r2-02: staleness is measured against the end of the data, not asOf', () => {
    const old = monthly('Netflix', 649, '2026-05-05', 4, { category: 'subscriptions' });
    expect(detectRecurring(old, ASOF)).toHaveLength(1);
    const lapsed = [...monthly('Netflix', 649, '2026-05-05', 3, { category: 'subscriptions' }), txn({ date: '2026-10-20', amount: 80, merchant: 'Cafe' })];
    expect(detectRecurring(lapsed, ASOF)).toHaveLength(0);
    const other = [...monthly('Netflix', 649, '2026-05-05', 3, { category: 'subscriptions' }), txn({ date: '2026-10-20', amount: 80, merchant: 'Cafe', accountId: 'other-acc' })];
    expect(detectRecurring(other, ASOF)).toHaveLength(1);
  });

  it('B-int-05: card bills paid through CRED are excluded; CREDIT/CREDITED words are not', () => {
    const cred = monthly('', 32000, '2026-07-05', 4, { category: 'other', merchant: undefined }).map((t) => ({ ...t, rawDescription: 'UPI-CRED CLUB-cred.club@axisb-UTIB0000100-412345678901-Payment' }));
    expect(detectRecurring(cred, ASOF)).toHaveLength(0);
    const credited = monthly('', 32000, '2026-07-05', 4, { category: 'other', merchant: undefined }).map((t) => ({ ...t, rawDescription: 'NEFT CR-ABCD0001234-GYM XYZ CREDITED' }));
    expect(detectRecurring(credited, ASOF)).toHaveLength(1);
    const upi = monthly('', 32000, '2026-07-05', 4, { category: 'other', merchant: undefined }).map((t) => ({ ...t, rawDescription: 'UPI/CR/412345/ACCREDITED GYM' }));
    expect(detectRecurring(upi, ASOF)).toHaveLength(1);
  });
});
