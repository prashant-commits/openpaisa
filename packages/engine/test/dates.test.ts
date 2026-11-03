import { describe, expect, it } from 'vitest';
import { addDays, addMonths, clampedDate, compareIso, dayOf, diffDays, isMonthEnd } from '../src/dates.js';
import { monthly, statement, txn } from './builders.js';

describe('dates', () => {
  it('addMonths clamps to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
    expect(addMonths('2026-01-31', 12)).toBe('2027-01-31');
  });
  it('addDays crosses year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('diffDays is b minus a', () => {
    expect(diffDays('2026-02-27', '2026-03-01')).toBe(2);
    expect(diffDays('2026-03-01', '2026-02-27')).toBe(-2);
    expect(diffDays('2026-01-01', '2026-01-01')).toBe(0);
  });
  it('compareIso orders dates', () => {
    expect(compareIso('2026-01-01', '2026-01-02')).toBeLessThan(0);
    expect(compareIso('2026-01-02', '2026-01-01')).toBeGreaterThan(0);
    expect(compareIso('2026-01-01', '2026-01-01')).toBe(0);
  });
});

describe('calendar helpers', () => {
  it('clampedDate clamps to month length', () => {
    expect(clampedDate(2026, 2, 31)).toBe('2026-02-28');
    expect(clampedDate(2028, 2, 31)).toBe('2028-02-29');
    expect(clampedDate(2026, 4, 25)).toBe('2026-04-25');
  });
  it('dayOf and isMonthEnd', () => {
    expect(dayOf('2026-03-09')).toBe(9);
    expect(isMonthEnd('2026-02-28')).toBe(true);
    expect(isMonthEnd('2026-02-27')).toBe(false);
    expect(isMonthEnd('2028-02-28')).toBe(false);
  });
});

describe('builders', () => {
  it('txn converts rupees to paise with defaults', () => {
    const t = txn({ date: '2026-01-05', amount: 649, merchant: 'Netflix' });
    expect(t.amount).toBe(64900);
    expect(t.direction).toBe('debit');
    expect(t.accountId).toBe('hdfc-sav-1234');
  });
  it('monthly builds a series with unique ids and clamped days', () => {
    const rows = monthly('Gym', 999, '2026-01-31', 3);
    expect(rows.map((r) => r.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(new Set(rows.map((r) => r.rawDescription)).size).toBe(3);
  });
  it('statement wraps transactions', () => {
    const s = statement({ id: 'x' }, [txn({ date: '2026-01-05', amount: 1 })]);
    expect(s.account.id).toBe('x');
    expect(s.transactions[0]?.accountId).toBe('x');
  });
});
