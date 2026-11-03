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
import { hdfcCard } from '../../src/parsers/cards/hdfc.js';
import { parseStatement } from '../../src/parsers/index.js';

const fixtures: Record<string, string> = { hdfcSavings: hdfcSavingsTxt, iciciSavings: iciciSavingsTxt, sbiSavings: sbiSavingsTxt, axisSavings: axisSavingsTxt, kotakSavings: kotakSavingsTxt, hdfcCard: hdfcCardTxt, iciciCard: iciciCardTxt, sbiCard: sbiCardTxt, axisCard: axisCardTxt };

describe('HDFC Bank credit card parser', () => {
  const text = hdfcCardTxt;
  const s = hdfcCard.parse(text);

  it('detects only its own format', () => {
    expect(hdfcCard.id).toBe('hdfc-card-pdf');
    expect(hdfcCard.detect(text)).toBeGreaterThan(0.8);
    for (const [name, other] of Object.entries(fixtures)) {
      if (name !== 'hdfcCard') expect(hdfcCard.detect(other), name).toBeLessThan(0.5);
    }
  });

  it('reads the account and card summary', () => {
    expect(s.account).toMatchObject({ id: 'hdfc-cc-4321', institution: 'HDFC Bank', kind: 'credit_card', last4: '4321', creditLimit: 20000000 });
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
    expect(hdfcCard.parse(text).transactions.map((t) => t.id)).toEqual(s.transactions.map((t) => t.id));
    expect(s.transactions.every((t) => t.balanceAfter === undefined && t.accountId === 'hdfc-cc-4321')).toBe(true);
  });

  it('warns when the rows do not add up to the total due', () => {
    const bad = hdfcCard.parse(text.replace('342.50', '343.50'));
    expect(bad.warnings).toHaveLength(1);
    expect(bad.warnings[0]).toMatch(/does not reconcile/);
  });

  it('returns no rows plus a warning when the table is empty', () => {
    const lines = text.split('\n');
    const head = lines.slice(0, lines.findIndex((l) => /^Date /.test(l)) + 1).join('\n');
    const e = hdfcCard.parse(head);
    expect(e.transactions).toEqual([]);
    expect(e.warnings.length).toBeGreaterThan(0);
  });

  it('is picked by parseStatement', () => {
    expect(parseStatement(text).account.id).toBe('hdfc-cc-4321');
  });

  it('reads Rs.-glued summary amounts and credits printed as negatives (A-r1-05)', () => {
    const glued = text.replace(/Rs\. /g, 'Rs.').replace('PAYMENT RECEIVED - THANK YOU 11,200.00 Cr', 'PAYMENT RECEIVED - THANK YOU -11,200.00');
    const g = hdfcCard.parse(glued);
    expect(g.card).toEqual(s.card);
    expect(g.account.creditLimit).toBe(20000000);
    expect(g.transactions.find((t) => /PAYMENT RECEIVED/.test(t.rawDescription))).toMatchObject({ direction: 'credit', amount: 1120000 });
    expect(g.transactions).toHaveLength(s.transactions.length);
  });
});
