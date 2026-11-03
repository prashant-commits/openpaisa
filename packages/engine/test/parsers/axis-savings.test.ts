import { describe, expect, it } from 'vitest';
import hdfc from '../fixtures/hdfc-savings.txt?raw';
import icici from '../fixtures/icici-savings.txt?raw';
import sbi from '../fixtures/sbi-savings.txt?raw';
import axis from '../fixtures/axis-savings.txt?raw';
import kotak from '../fixtures/kotak-savings.txt?raw';
import { axisSavings } from '../../src/parsers/savings/axis.js';
import { parseStatement } from '../../src/parsers/index.js';

const fixtures = { hdfc, icici, sbi, axis, kotak };

describe('Axis Bank savings parser', () => {
  const text = axis;
  const s = axisSavings.parse(text);

  it('detects only its own format', () => {
    expect(axisSavings.id).toBe('axis-savings-pdf');
    expect(axisSavings.institution).toBe('Axis Bank');
    expect(axisSavings.detect(text)).toBeGreaterThan(0.8);
    for (const [name, other] of Object.entries(fixtures)) {
      if (name !== 'axis') expect(axisSavings.detect(other), name).toBeLessThan(0.5);
    }
  });

  it('reads account, period and balances', () => {
    expect(s.account).toMatchObject({ id: 'axis-sav-3456', institution: 'Axis Bank', kind: 'savings', last4: '3456' });
    expect(s.periodStart).toBe('2026-09-01');
    expect(s.periodEnd).toBe('2026-10-31');
    expect(s.openingBalance).toBe(7200000);
    expect(s.closingBalance).toBe(15695840);
  });

  it('parses all rows and reconciles', () => {
    expect(s.transactions).toHaveLength(18);
    expect(s.warnings).toEqual([]);
    expect(s.transactions[0]).toMatchObject({ date: '2026-09-01', amount: 8500000, direction: 'credit', balanceAfter: 15700000 });
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
    const bad = axisSavings.parse(text.replace(/\b649\.00/, '694.00'));
    expect(bad.warnings).toHaveLength(1);
  });

  it('is picked by parseStatement', () => {
    expect(parseStatement(text).account.id).toBe('axis-sav-3456');
  });
});
