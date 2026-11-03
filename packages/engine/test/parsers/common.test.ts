import { describe, expect, it } from 'vitest';
import { assembleRows, checkBalances, extractAmounts, findAmounts, makeId, makeTransaction, parseIndianDate } from '../../src/parsers/common.js';
import type { Transaction } from '../../src/types.js';

const tx = (amount: number, direction: 'debit' | 'credit', seq = 0): Transaction =>
  makeTransaction({ accountId: 'a', date: '2026-11-01', amount, direction, rawDescription: 'x', seq });

describe('parseIndianDate', () => {
  it('parses DD-first formats', () => {
    expect(parseIndianDate('03/11/2026')).toBe('2026-11-03');
    expect(parseIndianDate('03-11-26')).toBe('2026-11-03');
    expect(parseIndianDate('03 Nov 2026')).toBe('2026-11-03');
    expect(parseIndianDate('3-Nov-26')).toBe('2026-11-03');
    expect(parseIndianDate('03 Nov 26')).toBe('2026-11-03');
    expect(parseIndianDate('03-NOV-2026')).toBe('2026-11-03');
  });
  it('never reads month first', () => {
    expect(parseIndianDate('11/03/2026')).toBe('2026-03-11');
    expect(parseIndianDate('13/12/2026')).toBe('2026-12-13');
    expect(parseIndianDate('12/13/2026')).toBeNull();
  });
  it('rejects impossible dates', () => {
    expect(parseIndianDate('31/02/2026')).toBeNull();
    expect(parseIndianDate('29/02/2028')).toBe('2028-02-29');
    expect(parseIndianDate('29/02/2027')).toBeNull();
    expect(parseIndianDate('hello')).toBeNull();
  });
});

describe('extractAmounts', () => {
  it('reads values and markers in order', () => {
    expect(extractAmounts('UPI/xyz 1,250.00 Dr 45,000.00')).toEqual([{ value: 125000, marker: 'Dr' }, { value: 4500000 }]);
  });
  it('handles Cr, brackets, lakh grouping and ignores refs and rates', () => {
    expect(extractAmounts('PAYMENT 1,00,000.00 Cr')).toEqual([{ value: 10000000, marker: 'Cr' }]);
    expect(findAmounts('REFUND (1,000.00)')).toEqual([expect.objectContaining({ value: 100000, negative: true })]);
    expect(findAmounts('REFUND (1,000.00)')[0]!.marker).toBeUndefined();
    expect(extractAmounts('ref 412345678901 rate 8.75% 250.50')).toEqual([{ value: 25050 }]);
  });
  it('accepts a bracketed marker', () => {
    expect(extractAmounts('FEE 99.00(Dr) 1,000.00(Cr)')).toEqual([{ value: 9900, marker: 'Dr' }, { value: 100000, marker: 'Cr' }]);
  });
});

describe('findAmounts: Rs. prefixes and minus signs (A-r1-05)', () => {
  it('reads an amount glued to Rs., Rs, INR or the rupee sign', () => {
    expect(findAmounts('Total Amount Due : Rs.11,728.53').map((a) => a.value)).toEqual([1172853]);
    expect(findAmounts('Due Rs 500.00 INR1,000.50 \u20B9250.00').map((a) => a.value)).toEqual([50000, 100050, 25000]);
  });
  it('reports a leading minus as negative', () => {
    const [a] = findAmounts('PAYMENT RECEIVED -11,200.00');
    expect(a).toMatchObject({ value: 1120000, negative: true });
    expect(findAmounts('-11,200.00')[0]).toMatchObject({ value: 1120000, negative: true });
    expect(findAmounts('PAYMENT 11,200.00')[0]!.negative).toBeUndefined();
  });
  it('still rejects refs and glued tokens', () => {
    expect(findAmounts('REF N245678901.50')).toEqual([]);
    expect(findAmounts('XXXX1234.56')).toEqual([]);
    expect(findAmounts('NEFT-123.45')).toEqual([]);
    expect(findAmounts('UTR/12.50')).toEqual([]);
  });
});

describe('assembleRows', () => {
  it('joins continuation lines with a single space', () => {
    const rows = assembleRows(['01/11/2026 UPI/DR/1/SWIGGY', '/swiggy@icici 250.00', '02/11/2026 ATM 500.00'], (l) => /^\d\d\/\d\d\/\d{4}/.test(l));
    expect(rows).toEqual(['01/11/2026 UPI/DR/1/SWIGGY /swiggy@icici 250.00', '02/11/2026 ATM 500.00']);
  });
  it('drops lines before the first row start', () => {
    expect(assembleRows(['header', '01/11/2026 A 1.00'], (l) => /^\d\d\//.test(l))).toEqual(['01/11/2026 A 1.00']);
  });
});

describe('makeId / makeTransaction', () => {
  it('is deterministic 8-hex', () => {
    expect(makeId(['a', 1])).toBe(makeId(['a', 1]));
    expect(makeId(['a', 1])).toMatch(/^[0-9a-f]{8}$/);
    expect(makeId(['a', 1])).not.toBe(makeId(['a', 2]));
  });
  it('seq separates identical rows, same row has same id', () => {
    expect(tx(100, 'debit', 0).id).toBe(tx(100, 'debit', 0).id);
    expect(tx(100, 'debit', 0).id).not.toBe(tx(100, 'debit', 1).id);
  });
  it('fills defaults', () => {
    expect(tx(100, 'debit')).toMatchObject({ channel: 'other', confidence: 0.9, source: 'statement_pdf' });
  });
});

describe('checkBalances', () => {
  it('reconciles', () => {
    expect(checkBalances(100000, [tx(5000, 'credit'), tx(2000, 'debit')], 103000)).toBeNull();
  });
  it('warns when it does not', () => {
    expect(checkBalances(100000, [tx(2000, 'debit')], 103000)).toMatch(/does not reconcile/);
  });
  it('is silent without balances', () => {
    expect(checkBalances(undefined, [tx(1, 'debit')], 5)).toBeNull();
  });
});
