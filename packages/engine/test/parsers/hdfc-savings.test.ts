import { describe, expect, it } from 'vitest';
import hdfc from '../fixtures/hdfc-savings.txt?raw';
import icici from '../fixtures/icici-savings.txt?raw';
import { hdfcSavings } from '../../src/parsers/savings/hdfc.js';
import { parseStatement } from '../../src/parsers/index.js';

describe('HDFC savings parser', () => {
  const s = hdfcSavings.parse(hdfc);

  it('detects its own format and not others', () => {
    expect(hdfcSavings.id).toBe('hdfc-savings-pdf');
    expect(hdfcSavings.institution).toBe('HDFC Bank');
    expect(hdfcSavings.detect(hdfc)).toBeGreaterThan(0.8);
    expect(hdfcSavings.detect(icici)).toBeLessThan(0.5);
    expect(hdfcSavings.detect('hello world')).toBe(0);
  });

  it('reads account, period and balances', () => {
    expect(s.account).toMatchObject({ id: 'hdfc-sav-1234', institution: 'HDFC Bank', kind: 'savings', last4: '1234' });
    expect(s.periodStart).toBe('2026-09-01');
    expect(s.periodEnd).toBe('2026-10-31');
    expect(s.openingBalance).toBe(12500000);
    expect(s.closingBalance).toBe(20950840);
  });

  it('parses every row and reconciles', () => {
    expect(s.transactions).toHaveLength(19);
    expect(s.warnings).toEqual([]);
    const first = s.transactions[0]!;
    expect(first).toMatchObject({ date: '2026-09-01', amount: 8500000, direction: 'credit', balanceAfter: 21000000, source: 'statement_pdf' });
    expect(first.rawDescription).toContain('SALARY AUG');
    expect(first.rawDescription).not.toMatch(/85,000/);
  });

  it('gets direction from the balance change', () => {
    const debits = s.transactions.filter((t) => t.direction === 'debit');
    expect(debits).toHaveLength(15);
    expect(s.transactions.find((t) => /INT\.PD/.test(t.rawDescription))).toMatchObject({ direction: 'credit', amount: 123000 });
  });

  it('keeps both halves of a wrapped narration', () => {
    const w = s.transactions.filter((t) => t.rawDescription.includes('rahul.s@okaxis'));
    expect(w).toHaveLength(1);
    expect(w[0]!.rawDescription).toContain('RENT SHARE SEPTEMBER');
  });

  it('skips page furniture and repeated headers', () => {
    expect(s.transactions.some((t) => /Page 1 of 2|Withdrawal Amt/.test(t.rawDescription))).toBe(false);
  });

  it('gives identical rows in one statement different ids', () => {
    const swiggyOct3 = s.transactions.filter((t) => t.date === '2026-10-03' && /SWIGGY/.test(t.rawDescription));
    expect(swiggyOct3).toHaveLength(2);
    expect(swiggyOct3[0]!.id).not.toBe(swiggyOct3[1]!.id);
    expect(new Set(s.transactions.map((t) => t.id)).size).toBe(19);
  });

  it('gives the same ids when the same statement is parsed again', () => {
    expect(hdfcSavings.parse(hdfc).transactions.map((t) => t.id)).toEqual(s.transactions.map((t) => t.id));
  });

  it('warns once when an amount is tampered with', () => {
    const bad = hdfcSavings.parse(hdfc.replace('649.00 1,85,401.00', '694.00 1,85,401.00'));
    expect(bad.warnings).toHaveLength(1);
    expect(bad.transactions).toHaveLength(19);
  });

  it('warns and skips a row with an impossible date', () => {
    const bad = hdfcSavings.parse(hdfc.replace('05/09/26 ACH', '31/02/26 ACH'));
    expect(bad.transactions).toHaveLength(18);
    expect(bad.warnings.some((w) => /date/i.test(w))).toBe(true);
  });

  it('returns no rows plus a warning for a recognised statement with no table rows', () => {
    const head = hdfc.split('\n').slice(0, 9).join('\n');
    const e = hdfcSavings.parse(head);
    expect(e.transactions).toEqual([]);
    expect(e.warnings.length).toBeGreaterThan(0);
  });

  it('is picked by parseStatement', () => {
    expect(parseStatement(hdfc).account.id).toBe('hdfc-sav-1234');
  });

  const head = hdfc.split('\n').slice(0, 9).join('\n');
  const tail = 'STATEMENT SUMMARY\n';

  it('reads a bracketed amount with no balance column as a debit (A-r2-05)', () => {
    const p = hdfcSavings.parse(`${head}\n01/09/26 UPI-SOMEONE-x@okaxis 0000000000000001 01/09/26 (450.00)\n${tail}`);
    expect(p.transactions).toHaveLength(1);
    expect(p.transactions[0]).toMatchObject({ direction: 'debit', amount: 45000 });
  });

  it('does not trust a stale balance after a skipped row (A-r2-02)', () => {
    const rows = [
      '01/09/26 NEFT CR-HDFC0000001-ACME-SALARY AUG N1 01/09/26 85,000.00 1,00,000.00',
      '31/02/26 NEFT CR-HDFC0000001-ACME-SALARY SEP N2 31/02/26 85,000.00 1,85,000.00',
      '03/03/26 UPI-SWIGGY LIMITED-swiggy.rzp@icici-HDFC0000001-412345678902-UPI 0000412345678902 03/03/26 450.00 1,84,550.00',
    ].join('\n');
    const p = hdfcSavings.parse(`${head}\n${rows}\n${tail}`);
    const c = p.transactions.find((t) => /SWIGGY/.test(t.rawDescription))!;
    expect(c).toMatchObject({ direction: 'debit', amount: 45000 });
  });
});
