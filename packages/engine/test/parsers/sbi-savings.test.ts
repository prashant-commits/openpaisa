import { describe, expect, it } from 'vitest';
import hdfc from '../fixtures/hdfc-savings.txt?raw';
import icici from '../fixtures/icici-savings.txt?raw';
import sbi from '../fixtures/sbi-savings.txt?raw';
import axis from '../fixtures/axis-savings.txt?raw';
import kotak from '../fixtures/kotak-savings.txt?raw';
import { sbiSavings } from '../../src/parsers/savings/sbi.js';
import { parseStatement } from '../../src/parsers/index.js';

const fixtures = { hdfc, icici, sbi, axis, kotak };

describe('State Bank of India savings parser', () => {
  const text = sbi;
  const s = sbiSavings.parse(text);

  it('detects only its own format', () => {
    expect(sbiSavings.id).toBe('sbi-savings-pdf');
    expect(sbiSavings.institution).toBe('State Bank of India');
    expect(sbiSavings.detect(text)).toBeGreaterThan(0.8);
    for (const [name, other] of Object.entries(fixtures)) {
      if (name !== 'sbi') expect(sbiSavings.detect(other), name).toBeLessThan(0.5);
    }
  });

  it('reads account, period and balances', () => {
    expect(s.account).toMatchObject({ id: 'sbi-sav-9012', institution: 'State Bank of India', kind: 'savings', last4: '9012' });
    expect(s.periodStart).toBe('2026-09-01');
    expect(s.periodEnd).toBe('2026-10-31');
    expect(s.openingBalance).toBe(15000000);
    expect(s.closingBalance).toBe(23495840);
  });

  it('parses all rows and reconciles', () => {
    expect(s.transactions).toHaveLength(18);
    expect(s.warnings).toEqual([]);
    expect(s.transactions[0]).toMatchObject({ date: '2026-09-01', amount: 8500000, direction: 'credit', balanceAfter: 23500000 });
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
    const bad = sbiSavings.parse(text.replace(/\b649\.00/, '694.00'));
    expect(bad.warnings).toHaveLength(1);
  });

  it('is picked by parseStatement', () => {
    expect(parseStatement(text).account.id).toBe('sbi-sav-9012');
  });
});
