import { describe, expect, it } from 'vitest';
import { buildFlows, buildUpcoming, detectSalaryDay, liquidBalance, nextSalaryDate, safeToSpend } from '../src/flows.js';
import { detectRecurring } from '../src/recurring.js';
import type { Loan } from '../src/types.js';
import { monthly, statement, txn } from './builders.js';

const sal = (date: string, amount = 120000) => txn({ date, amount, direction: 'credit', category: 'salary', merchant: 'Acme Pvt Ltd' });

describe('detectSalaryDay', () => {
  it('uses the median day', () => {
    expect(detectSalaryDay([sal('2026-08-01'), sal('2026-09-01'), sal('2026-10-02')])).toBe(1);
  });
  it('treats month-end credits as day 31', () => {
    expect(detectSalaryDay([sal('2026-07-31'), sal('2026-08-31'), sal('2026-09-30')])).toBe(31);
    expect(detectSalaryDay([sal('2026-01-31'), sal('2026-02-28')])).toBe(31);
  });
  it('needs two months and recognises the SALARY keyword', () => {
    expect(detectSalaryDay([sal('2026-10-01')])).toBeUndefined();
    const k = (d: string) => txn({ date: d, amount: 5000, direction: 'credit', rawDescription: 'NEFT SALARY OCT' });
    expect(detectSalaryDay([k('2026-09-05'), k('2026-10-05')])).toBe(5);
    expect(detectSalaryDay([txn({ date: '2026-10-01', amount: 5, direction: 'credit', category: 'refund' })])).toBeUndefined();
  });
});

describe('buildFlows', () => {
  it('uses calendar months without a salary day', () => {
    const flows = buildFlows([
      sal('2026-09-01'), txn({ date: '2026-09-20', amount: 500, category: 'groceries' }),
      sal('2026-10-01'), txn({ date: '2026-10-20', amount: 700, category: 'dining' }),
    ]);
    expect(flows.map((f) => f.cycleStart)).toEqual(['2026-09-01', '2026-10-01']);
    expect(flows[0]).toMatchObject({ income: 12000000, spend: 50000, byCategory: { groceries: 50000 } });
  });
  it('cycles start on the salary day', () => {
    const flows = buildFlows([
      txn({ date: '2026-09-24', amount: 100, category: 'dining' }),
      txn({ date: '2026-09-25', amount: 200, category: 'dining' }),
      txn({ date: '2026-10-24', amount: 300, category: 'dining' }),
      txn({ date: '2026-10-25', amount: 400, category: 'dining' }),
    ], 25);
    expect(flows.map((f) => [f.cycleStart, f.spend])).toEqual([['2026-08-25', 10000], ['2026-09-25', 50000], ['2026-10-25', 40000]]);
  });
  it('clamps a day-31 cycle to month end', () => {
    const flows = buildFlows([txn({ date: '2026-03-02', amount: 10, category: 'dining' }), txn({ date: '2026-03-01', amount: 10, category: 'dining' })], 31);
    expect(flows[0]?.cycleStart).toBe('2026-02-28');
  });
  it('excludes transfers, card payments, investments from spend; refunds, transfers, card payments from income', () => {
    const flows = buildFlows([
      txn({ date: '2026-10-02', amount: 1000, category: 'transfers' }),
      txn({ date: '2026-10-03', amount: 2000, category: 'card_payment' }),
      txn({ date: '2026-10-04', amount: 3000, category: 'investments' }),
      txn({ date: '2026-10-05', amount: 400, category: 'groceries' }),
      txn({ date: '2026-10-06', amount: 100, direction: 'credit', category: 'refund' }),
      txn({ date: '2026-10-07', amount: 100, direction: 'credit', category: 'card_payment' }),
      txn({ date: '2026-10-08', amount: 100, direction: 'credit', category: 'transfers' }),
      txn({ date: '2026-10-09', amount: 900, direction: 'credit', category: 'interest' }),
    ]);
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ spend: 40000, income: 90000 });
  });
  it('is empty for no transactions', () => {
    expect(buildFlows([])).toEqual([]);
  });
});

describe('buildUpcoming', () => {
  const asOf = '2026-11-03';
  const netflix = monthly('Netflix', 649, '2026-06-05', 5, { category: 'subscriptions' });
  it('includes recurring and card dues in the next 45 days, excludes later ones', () => {
    const recurring = detectRecurring([...netflix, txn({ date: '2025-12-30', amount: 1499, merchant: 'Annual Club' }), txn({ date: '2024-12-30', amount: 1499, merchant: 'Annual Club' })], asOf);
    expect(recurring.map((r) => r.merchant)).toContain('Annual Club');
    const stmt = statement({ id: 'icici-cc-5678', institution: 'ICICI Bank', kind: 'credit_card' }, [], {
      card: { totalDue: 4200000, minimumDue: 210000, dueDate: '2026-11-10' },
    });
    const up = buildUpcoming(recurring, [stmt], [], asOf);
    expect(up.map((u) => [u.date, u.label, u.source])).toEqual([
      ['2026-11-05', 'Netflix', 'recurring'],
      ['2026-11-10', 'ICICI Bank card due', 'card_due'],
      ['2026-12-05', 'Netflix', 'recurring'],
    ]);
  });
  it('does not include a past card due', () => {
    const stmt = statement({ id: 'cc', kind: 'credit_card' }, [], { card: { totalDue: 100, minimumDue: 10, dueDate: '2026-11-02' } });
    expect(buildUpcoming([], [stmt], [], asOf)).toEqual([]);
  });
  it('labels EMIs and does not double-add a loan already in recurring', () => {
    const emiTxns = monthly('HDFC Ltd', 43391.16, '2026-06-05', 5, { category: 'emi' });
    const recurring = detectRecurring(emiTxns, asOf);
    const loan: Loan = { id: 'l', lender: 'HDFC Ltd', kind: 'home', emi: 4339116, startDate: '2025-11-05', emiTransactionIds: emiTxns.map((t) => t.id), confidence: 0.6 };
    const up = buildUpcoming(recurring, [], [loan], asOf);
    expect(up.filter((u) => u.source === 'emi')).toHaveLength(2);
  });
  it('adds a loan with a start date that recurring did not find', () => {
    const loan: Loan = { id: 'l', lender: 'Axis Fin', kind: 'personal', emi: 500000, startDate: '2026-01-15', emiTransactionIds: [], confidence: 0.6 };
    const up = buildUpcoming([], [], [loan], asOf);
    expect(up.map((u) => u.date)).toEqual(['2026-11-15', '2026-12-15']);
  });
});

describe('safeToSpend', () => {
  const asOf = '2026-11-03';
  it('subtracts commitments before the next payday', () => {
    const stmt = statement({ id: 'hdfc-sav-1234' }, [], { closingBalance: 8000000, periodEnd: '2026-11-02' });
    const upcoming = [
      { date: '2026-11-05', label: 'HDFC Ltd EMI', amount: 4339116, source: 'emi' as const },
      { date: '2026-11-05', label: 'Netflix', amount: 64900, source: 'recurring' as const },
      { date: '2026-12-05', label: 'Netflix', amount: 64900, source: 'recurring' as const },
    ];
    expect(safeToSpend([stmt], upcoming, asOf, 1)).toEqual({ untilDate: '2026-12-01', amount: 8000000 - 4339116 - 64900 });
  });
  it('is undefined without a salary day or balances, and floors at zero', () => {
    const stmt = statement({}, [], { closingBalance: 1000, periodEnd: '2026-11-02' });
    expect(safeToSpend([stmt], [], asOf)).toBeUndefined();
    expect(safeToSpend([statement({}, [])], [], asOf, 1)).toBeUndefined();
    const big = [{ date: '2026-11-05', label: 'x', amount: 5000, source: 'recurring' as const }];
    expect(safeToSpend([stmt], big, asOf, 1)?.amount).toBe(0);
  });
  it('ignores credit cards and uses the latest statement per account', () => {
    const a = statement({ id: 'a' }, [], { closingBalance: 100, periodEnd: '2026-09-30' });
    const b = statement({ id: 'a' }, [], { closingBalance: 500, periodEnd: '2026-10-31' });
    const c = statement({ id: 'cc', kind: 'credit_card' }, [], { closingBalance: 99999, periodEnd: '2026-10-31' });
    expect(liquidBalance([a, b, c])).toBe(500);
  });
  it('finds the next payday strictly after asOf, clamping', () => {
    expect(nextSalaryDate('2026-11-03', 1)).toBe('2026-12-01');
    expect(nextSalaryDate('2026-11-03', 25)).toBe('2026-11-25');
    expect(nextSalaryDate('2026-01-31', 31)).toBe('2026-02-28');
    expect(nextSalaryDate('2026-11-25', 25)).toBe('2026-12-25');
  });
});

describe('buildUpcoming loans already in recurring', () => {
  it('B-r1-05: does not add a loan twice when its NACH series is kind other', () => {
    const t = monthly('', 12500, '2026-06-05', 5, { category: 'shopping', merchant: undefined, channel: 'nach' }).map((x, i) => ({ ...x, rawDescription: `NACH AXIS PERSONAL LOAN EMI ${i}` }));
    const recurring = detectRecurring(t, '2026-11-03');
    expect(recurring).toHaveLength(1);
    const loan: Loan = { id: 'l1', lender: 'Axis', kind: 'personal', emi: 1250000, principal: 50000000, annualRatePct: 12, tenureMonths: 48, startDate: '2026-06-05', emiTransactionIds: recurring[0]!.occurrences, confidence: 0.6 };
    const up = buildUpcoming(recurring, [], [loan], '2026-11-03');
    expect(up.map((u) => u.date)).toEqual(['2026-11-05', '2026-12-05']);
    expect(up.every((u) => u.source === 'emi' && u.label !== 'Axis EMI')).toBe(true);
  });
});
