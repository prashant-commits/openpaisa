import { describe, expect, it } from 'vitest';
import hdfc from '../fixtures/hdfc-savings.txt?raw';
import icici from '../fixtures/icici-savings.txt?raw';
import sbi from '../fixtures/sbi-savings.txt?raw';
import axis from '../fixtures/axis-savings.txt?raw';
import kotak from '../fixtures/kotak-savings.txt?raw';
import { kotakSavings } from '../../src/parsers/savings/kotak.js';
import { parseStatement } from '../../src/parsers/index.js';

const fixtures = { hdfc, icici, sbi, axis, kotak };

describe('Kotak Mahindra Bank savings parser', () => {
  const text = kotak;
  const s = kotakSavings.parse(text);

  it('detects only its own format', () => {
    expect(kotakSavings.id).toBe('kotak-savings-pdf');
    expect(kotakSavings.institution).toBe('Kotak Mahindra Bank');
    expect(kotakSavings.detect(text)).toBeGreaterThan(0.8);
    for (const [name, other] of Object.entries(fixtures)) {
      if (name !== 'kotak') expect(kotakSavings.detect(other), name).toBeLessThan(0.5);
    }
  });

  it('reads account, period and balances', () => {
    expect(s.account).toMatchObject({ id: 'kotak-sav-7890', institution: 'Kotak Mahindra Bank', kind: 'savings', last4: '7890' });
    expect(s.periodStart).toBe('2026-09-01');
    expect(s.periodEnd).toBe('2026-10-31');
    expect(s.openingBalance).toBe(11000000);
    expect(s.closingBalance).toBe(19495840);
  });

  it('parses all rows and reconciles', () => {
    expect(s.transactions).toHaveLength(18);
    expect(s.warnings).toEqual([]);
    expect(s.transactions[0]).toMatchObject({ date: '2026-09-01', amount: 8500000, direction: 'credit', balanceAfter: 19500000 });
    expect(s.transactions.filter((t) => t.direction === 'debit')).toHaveLength(14);
    expect(new Set(s.transactions.map((t) => t.id)).size).toBe(18);
  });

  it('keeps both halves of the wrapped narration', () => {
    const w = s.transactions.filter((t) => t.rawDescription.includes('RAHUL SHARMA') && t.rawDescription.includes('RENT SHARE SEPTEMBER'));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ amount: 250000, direction: 'debit', date: '2026-09-21' });
  });

  it('leaves no amounts or layout noise in narrations', () => {
    for (const t of s.transactions) expect(t.rawDescription).not.toMatch(/\d,\d{3}\.\d\d|\d\.\d\d$/);
    expect(s.transactions.find((t) => /SMS CHARGES/.test(t.rawDescription))).toMatchObject({ amount: 2360, direction: 'debit' });
  });

  it('warns once when an amount is tampered with', () => {
    const bad = kotakSavings.parse(text.replace(/\b649\.00/, '694.00'));
    expect(bad.warnings).toHaveLength(1);
  });

  it('is picked by parseStatement', () => {
    expect(parseStatement(text).account.id).toBe('kotak-sav-7890');
  });
});
