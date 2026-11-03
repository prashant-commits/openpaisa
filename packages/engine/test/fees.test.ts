import { describe, expect, it } from 'vitest';
import { detectFees } from '../src/fees.js';
import { txn } from './builders.js';

const ASOF = '2026-10-30';
const anchor = txn({ date: '2026-08-01', amount: 100, merchant: 'Anchor', rawDescription: 'GROCERY' });

describe('detectFees', () => {
  it('maps each pattern to its kind', () => {
    const cases: [string, string][] = [
      ['LATE PAYMENT FEE', 'late_fee'],
      ['LATE FEE CHARGED', 'late_fee'],
      ['FINANCE CHARGES', 'card_interest'],
      ['INTEREST CHARGED ON RETAIL', 'card_interest'],
      ['FOREX MARKUP FEE', 'forex_markup'],
      ['CROSS CURRENCY MARKUP', 'forex_markup'],
      ['DCC FEE', 'forex_markup'],
      ['ANNUAL FEE', 'fee_paid'],
      ['SMS CHARGES Q2', 'fee_paid'],
      ['CHQ RETURN CHG', 'fee_paid'],
      ['MIN BAL PENALTY', 'fee_paid'],
      ['NON MAINT OF AMB', 'fee_paid'],
      ['ATM WDL FEE', 'fee_paid'],
      ['DEBIT CARD AMC CHGS', 'fee_paid'],
      ['ANNUAL MAINTENANCE CHARGES', 'fee_paid'],
      ['FOREX CONV FEE', 'forex_markup'],
    ];
    for (const [desc, kind] of cases) {
      const out = detectFees([anchor, txn({ date: '2026-10-01', amount: 100, rawDescription: desc })], ASOF);
      expect(out.map((i) => i.kind), desc).toEqual([kind]);
    }
  });

  it('adds same-day GST to the fee total', () => {
    const fee = txn({ date: '2026-09-10', amount: 1000, rawDescription: 'LATE PAYMENT FEE' });
    const gst = txn({ date: '2026-09-10', amount: 180, rawDescription: 'IGST @18%' });
    const other = txn({ date: '2026-09-11', amount: 50, rawDescription: 'CGST unrelated' });
    const out = detectFees([anchor, fee, gst, other], ASOF);
    expect(out).toHaveLength(1);
    const i = out[0]!;
    expect(i.kind).toBe('late_fee');
    expect(i.severity).toBe('act');
    expect(i.transactionIds).toEqual([fee.id, gst.id]);
    expect(i.title).toBe('You paid ₹1,180 in late fees');
    expect(i.annualImpact).toBe(Math.round((118000 * 365) / 90));
  });

  it('annualises over the observed window', () => {
    const sms = txn({ date: '2026-09-01', amount: 59, rawDescription: 'SMS CHARGES' });
    const out = detectFees([anchor, sms], ASOF);
    expect(out[0]?.annualImpact).toBe(Math.round((5900 * 365) / 90));
  });

  it('uses a 30-day floor for short windows', () => {
    const sms = txn({ date: '2026-10-20', amount: 59, rawDescription: 'SMS CHARGES' });
    expect(detectFees([sms], ASOF)[0]?.annualImpact).toBe(Math.round((5900 * 365) / 30));
  });

  it('groups fees of the same kind and sorts kinds consistently', () => {
    const a = txn({ date: '2026-09-01', amount: 59, rawDescription: 'SMS CHARGES' });
    const b = txn({ date: '2026-10-01', amount: 590, rawDescription: 'ANNUAL FEE' });
    const c = txn({ date: '2026-10-02', amount: 350, rawDescription: 'FOREX MARKUP' });
    const out = detectFees([anchor, a, b, c], ASOF);
    expect(out.map((i) => i.kind)).toEqual(['forex_markup', 'fee_paid']);
    expect(out[1]?.transactionIds).toEqual([a.id, b.id]);
  });

  it('only counts card interest on card accounts when told which they are', () => {
    const t = txn({ date: '2026-10-01', amount: 900, rawDescription: 'FINANCE CHARGES', accountId: 'icici-cc-5678' });
    expect(detectFees([t], ASOF, new Set(['icici-cc-5678']))[0]?.kind).toBe('card_interest');
    expect(detectFees([t], ASOF, new Set(['hdfc-sav-1234']))).toEqual([]);
  });

  it('ignores credits and clean data', () => {
    expect(detectFees([anchor], ASOF)).toEqual([]);
    expect(detectFees([], ASOF)).toEqual([]);
    expect(detectFees([txn({ date: '2026-10-01', amount: 100, direction: 'credit', rawDescription: 'LATE FEE REVERSAL' })], ASOF)).toEqual([]);
  });

  it('does not treat SIPs to an AMC as fees (FINAL-r1-01)', () => {
    for (const category of ['investments', undefined] as const) {
      const sips = [5, 6, 7, 8, 9, 10].map((m) =>
        txn({ date: `2026-${String(m).padStart(2, '0')}-05`, amount: 10000, rawDescription: 'ACH D- HDFC AMC LTD-SIP 1234', category }),
      );
      const out = detectFees([anchor, ...sips], '2026-11-03');
      expect(out, String(category)).toEqual([]);
    }
    for (const name of ['KOTAK MAHINDRA AMC', 'UTI AMC', 'NIPPON LIFE INDIA AMC', 'AXIS AMC']) {
      expect(detectFees([txn({ date: '2026-10-05', amount: 5000, rawDescription: `ACH D- ${name} SIP` })], ASOF)).toEqual([]);
    }
  });

  it('skips rows whose category cannot be a fee', () => {
    const t = txn({ date: '2026-10-05', amount: 5000, rawDescription: 'SMS CHARGES', category: 'emi' });
    expect(detectFees([t], ASOF)).toEqual([]);
  });

  it('ignores forex purchases and card reloads (FINAL-r1-06)', () => {
    for (const d of ['BOOKMYFOREX CARD RELOAD', 'THOMAS COOK FOREX']) {
      expect(detectFees([txn({ date: '2026-10-05', amount: 50000, rawDescription: d })], ASOF), d).toEqual([]);
    }
  });
});
