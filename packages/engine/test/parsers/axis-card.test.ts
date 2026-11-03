import { describe, expect, it } from 'vitest';
import hdfcSavingsTxt from '../fixtures/hdfc-savings.txt?raw';
import iciciSavingsTxt from '../fixtures/icici-savings.txt?raw';
import sbiSavingsTxt from '../fixtures/sbi-savings.txt?raw';
import axisSavingsTxt from '../fixtures/axis-savings.txt?raw';
import kotakSavingsTxt from '../fixtures/kotak-savings.txt?raw';
import hdfcCardTxt from '../fixtures/hdfc-card.txt?raw';
import iciciCardTxt from '../fixtures/icici-card.txt?raw';
import sbiCardTxt from '../fixtures/sbi-card.txt?raw';
import axisCardTxt from '../fixtures/axis-card.txt?raw';
import { axisCard } from '../../src/parsers/cards/axis.js';
import { parseStatement } from '../../src/parsers/index.js';

const fixtures: Record<string, string> = { hdfcSavings: hdfcSavingsTxt, iciciSavings: iciciSavingsTxt, sbiSavings: sbiSavingsTxt, axisSavings: axisSavingsTxt, kotakSavings: kotakSavingsTxt, hdfcCard: hdfcCardTxt, iciciCard: iciciCardTxt, sbiCard: sbiCardTxt, axisCard: axisCardTxt };

describe('Axis Bank credit card parser', () => {
  const text = axisCardTxt;
  const s = axisCard.parse(text);

  it('detects only its own format', () => {
    expect(axisCard.id).toBe('axis-card-pdf');
    expect(axisCard.detect(text)).toBeGreaterThan(0.8);
    for (const [name, other] of Object.entries(fixtures)) {
      if (name !== 'axisCard') expect(axisCard.detect(other), name).toBeLessThan(0.5);
    }
  });

  it('reads the account and card summary', () => {
    expect(s.account).toMatchObject({ id: 'axis-cc-2468', institution: 'Axis Bank', kind: 'credit_card', last4: '2468', creditLimit: 25000000 });
    expect(s.card).toEqual({ totalDue: 1172853, minimumDue: 58600, dueDate: '2026-11-20', statementDate: '2026-10-31' });
    expect(s.periodStart).toBe('2026-10-01');
    expect(s.periodEnd).toBe('2026-10-31');
  });

  it('parses every row and reconciles to the total due', () => {
    expect(s.transactions).toHaveLength(15);
    expect(s.warnings).toEqual([]);
    expect(s.transactions.filter((t) => t.direction === 'credit')).toHaveLength(2);
    expect(s.openingBalance).toBe(1120000);
    expect(s.closingBalance).toBe(1172853);
  });

  it('marks the payment and refund as credits and purchases as debits', () => {
    expect(s.transactions.find((t) => /PAYMENT RECEIVED/.test(t.rawDescription))).toMatchObject({ direction: 'credit', amount: 1120000, date: '2026-10-13' });
    expect(s.transactions.find((t) => /REFUND/.test(t.rawDescription))).toMatchObject({ direction: 'credit', amount: 49900 });
    expect(s.transactions.find((t) => /SWIGGY/.test(t.rawDescription))).toMatchObject({ direction: 'debit', amount: 45000, date: '2026-10-02' });
  });

  it('keeps fee, interest, GST, forex and EMI rows', () => {
    const by = (re: RegExp) => s.transactions.find((t) => re.test(t.rawDescription));
    expect(by(/LATE PAYMENT FEE/)).toMatchObject({ amount: 50000, direction: 'debit' });
    expect(by(/FINANCE CHARGES/)).toMatchObject({ amount: 61240 });
    expect(by(/IGST ON LATE/)).toMatchObject({ amount: 9000 });
    expect(by(/MARKUP FEE/)).toMatchObject({ amount: 3528 });
    expect(by(/SPOTIFY/)).toMatchObject({ amount: 100800 });
    expect(by(/EMI 3\/12/)).toMatchObject({ amount: 325000 });
  });

  it('appends a wrapped line to its row', () => {
    const w = s.transactions.filter((t) => /BIGBASKET/.test(t.rawDescription));
    expect(w).toHaveLength(1);
    expect(w[0]!.rawDescription).toContain('BENGALURU IN');
    expect(w[0]).toMatchObject({ amount: 184500, date: '2026-10-24' });
  });

  it('uses distinct deterministic ids and no balanceAfter', () => {
    expect(new Set(s.transactions.map((t) => t.id)).size).toBe(15);
    expect(axisCard.parse(text).transactions.map((t) => t.id)).toEqual(s.transactions.map((t) => t.id));
    expect(s.transactions.every((t) => t.balanceAfter === undefined && t.accountId === 'axis-cc-2468')).toBe(true);
  });

  it('warns when the rows do not add up to the total due', () => {
    const bad = axisCard.parse(text.replace('342.50', '343.50'));
    expect(bad.warnings).toHaveLength(1);
    expect(bad.warnings[0]).toMatch(/does not reconcile/);
  });

  it('returns no rows plus a warning when the table is empty', () => {
    const lines = text.split('\n');
    const head = lines.slice(0, lines.findIndex((l) => /^Date /.test(l)) + 1).join('\n');
    const e = axisCard.parse(head);
    expect(e.transactions).toEqual([]);
    expect(e.warnings.length).toBeGreaterThan(0);
  });

  it('is picked by parseStatement', () => {
    expect(parseStatement(text).account.id).toBe('axis-cc-2468');
  });
});
