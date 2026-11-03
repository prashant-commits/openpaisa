import { describe, expect, it } from 'vitest';
import axisCard from '../fixtures/axis-card.txt?raw';
import axisSavings from '../fixtures/axis-savings.txt?raw';
import hdfcCard from '../fixtures/hdfc-card.txt?raw';
import hdfcSavings from '../fixtures/hdfc-savings.txt?raw';
import iciciCard from '../fixtures/icici-card.txt?raw';
import iciciSavings from '../fixtures/icici-savings.txt?raw';
import kotakSavings from '../fixtures/kotak-savings.txt?raw';
import sbiCard from '../fixtures/sbi-card.txt?raw';
import sbiSavings from '../fixtures/sbi-savings.txt?raw';
import { categoriseTransactions } from '../../src/categorise.js';
import { dedupeTransactions } from '../../src/dedupe.js';
import { normaliseTransactions } from '../../src/normalise.js';
import { parseStatement, parsers } from '../../src/parsers/index.js';
import { matchMerchant } from '../../src/parsers/merchants.js';

const fixtures: [string, string, string][] = [
  ['hdfc-savings-pdf', hdfcSavings, 'hdfc-sav-1234'],
  ['icici-savings-pdf', iciciSavings, 'icici-sav-5678'],
  ['sbi-savings-pdf', sbiSavings, 'sbi-sav-9012'],
  ['axis-savings-pdf', axisSavings, 'axis-sav-3456'],
  ['kotak-savings-pdf', kotakSavings, 'kotak-sav-7890'],
  ['hdfc-card-pdf', hdfcCard, 'hdfc-cc-4321'],
  ['icici-card-pdf', iciciCard, 'icici-cc-5678'],
  ['sbi-card-pdf', sbiCard, 'sbi-cc-8765'],
  ['axis-card-pdf', axisCard, 'axis-cc-2468'],
];

const run = (texts: string[]) =>
  categoriseTransactions(dedupeTransactions(normaliseTransactions(texts.flatMap((t) => parseStatement(t).transactions))));

describe('parser registry', () => {
  it.each(fixtures)('%s picks the right parser for its fixture', (id, text, accountId) => {
    const ranked = parsers.map((p) => ({ id: p.id, s: p.detect(text) })).filter((x) => x.s > 0.5);
    expect(ranked.map((r) => r.id)).toEqual([id]);
    const s = parseStatement(text);
    expect(s.account.id).toBe(accountId);
    expect(s.warnings).toEqual([]);
  });

  it('registers every bank plus generic CSV', () => {
    expect(parsers.map((p) => p.id).sort()).toEqual([...fixtures.map((f) => f[0]), 'generic-csv'].sort());
  });

  it('throws the unsupported-format error on random text', () => {
    expect(() => parseStatement('hello world')).toThrow(/Unsupported statement format/);
    expect(() => parseStatement('')).toThrow(/Unsupported statement format/);
  });
});

describe('full pipeline over all fixtures', () => {
  const all = run(fixtures.map((f) => f[1]));

  it('categorises every transaction whose merchant is in the dictionary', () => {
    const missed = all.filter((t) => {
      const m = t.merchant ? matchMerchant(t.merchant) : null;
      return m && m.category !== 'other' && t.category === 'other';
    });
    expect(missed).toEqual([]);
  });

  it('gets the headline categories right', () => {
    const find = (re: RegExp, accountPrefix = '') => all.filter((t) => re.test(t.rawDescription) && t.accountId.startsWith(accountPrefix));
    expect(find(/SALARY/).every((t) => t.category === 'salary')).toBe(true);
    expect(find(/NETFLIX/).every((t) => t.category === 'subscriptions')).toBe(true);
    expect(find(/SWIGGY/).every((t) => t.category === 'food_delivery')).toBe(true);
    expect(find(/SMS CHARGES/).every((t) => t.category === 'fees_charges')).toBe(true);
    expect(find(/LATE PAYMENT FEE/).every((t) => t.category === 'fees_charges')).toBe(true);
    expect(find(/FINANCE CHARGES/).every((t) => t.category === 'fees_charges')).toBe(true);
    expect(find(/INT\.PD/).every((t) => t.category === 'interest')).toBe(true);
    expect(find(/ATM WDL/).every((t) => t.category === 'cash_withdrawal')).toBe(true);
    expect(find(/EMI 4567/).every((t) => t.category === 'emi')).toBe(true);
    expect(find(/SIP 8821/).every((t) => t.category === 'investments')).toBe(true);
    expect(find(/REFUND/).every((t) => t.category === 'refund')).toBe(true);
  });

  it('never leaves a card payment counted as spend or income', () => {
    const payments = all.filter((t) => /PAYMENT RECEIVED|CREDIT CARD PAYMENT/.test(t.rawDescription));
    expect(payments.length).toBeGreaterThan(0);
    expect(payments.filter((t) => t.accountId.includes('-cc-')).every((t) => t.category === 'card_payment')).toBe(true);
    // each card payment credit found its savings-side debit
    const matched = payments.filter((t) => !t.accountId.includes('-cc-') && t.category === 'card_payment');
    expect(matched.length).toBe(4);
  });

  it('keeps ids unique', () => {
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
  });

  it('is sorted by date', () => {
    const dates = all.map((t) => t.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('same statement uploaded twice', () => {
  it('collapses to the single-upload result', () => {
    for (const [, text] of fixtures) {
      expect(run([text, text])).toEqual(run([text]));
    }
  });

  it('keeps genuinely repeated rows within one statement', () => {
    expect(run([hdfcSavings]).filter((t) => t.date === '2026-10-03' && /SWIGGY/.test(t.rawDescription))).toHaveLength(2);
  });
});
