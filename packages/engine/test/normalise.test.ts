import { describe, expect, it } from 'vitest';
import { normaliseTransactions } from '../src/normalise.js';
import { makeTransaction } from '../src/parsers/common.js';
import { matchMerchant } from '../src/parsers/merchants.js';
import type { Channel, Direction, Transaction } from '../src/types.js';

const mk = (rawDescription: string, direction: Direction = 'debit', accountId = 'hdfc-sav-1234'): Transaction =>
  makeTransaction({ accountId, date: '2026-10-05', amount: 100000, direction, rawDescription, seq: 0 });

const table: [string, Direction, string, Channel, string | undefined][] = [
  ['UPI/DR/412345678901/NETFLIX/hdfc/netflix@hdfc', 'debit', 'Netflix', 'upi', '412345678901'],
  ['UPI-SWIGGY LIMITED-swiggy.rzp@icici-ICIC0000001-412345678902-PAYMENT', 'debit', 'Swiggy', 'upi', '412345678902'],
  ['UPI/CR/412345678903/RAHUL SHARMA/SBIN/rahul@okaxis', 'credit', 'Rahul Sharma', 'upi', '412345678903'],
  ['NACH/HDFCBANKLTD/LOAN 12345', 'debit', 'HDFC Bank', 'nach', undefined],
  ['ACH D- BSE LIMITED-SIP', 'debit', 'BSE', 'nach', undefined],
  ['POS 4321XXXXXXXX1234 AMAZON PAY INDIA', 'debit', 'Amazon', 'card', undefined],
  ['NEFT CR-ACME TECH PVT LTD-SALARY OCT', 'credit', 'Acme Tech Pvt Ltd', 'neft', undefined],
  ['IMPS/P2A/412345678904/MOM', 'debit', 'Mom', 'imps', undefined],
  ['ATM WDL 12345 MG ROAD', 'debit', 'ATM', 'atm', undefined],
  ['INT.PD:01-07-2026 TO 30-09-2026', 'credit', 'Interest', 'interest', undefined],
  ['SMS CHARGES QTR', 'debit', 'Bank charges', 'fee', undefined],
];

describe('normaliseTransactions', () => {
  it.each(table)('%s', (raw, dir, merchant, channel, upiRef) => {
    const [n] = normaliseTransactions([mk(raw, dir)]);
    expect(n!.merchant).toBe(merchant);
    expect(n!.channel).toBe(channel);
    expect(n!.upiRef).toBe(upiRef);
  });

  it('never changes id, amount, date or direction', () => {
    const t = mk('UPI/DR/412345678901/NETFLIX/hdfc/netflix@hdfc');
    const [n] = normaliseTransactions([t]);
    expect(n).toMatchObject({ id: t.id, amount: t.amount, date: t.date, direction: t.direction, rawDescription: t.rawDescription });
  });

  it('does not mutate its input', () => {
    const t = mk('UPI/DR/412345678901/NETFLIX/hdfc/netflix@hdfc');
    normaliseTransactions([t]);
    expect(t.merchant).toBeUndefined();
    expect(t.channel).toBe('other');
  });

  it('title-cases unknown payees and lets dictionary names win', () => {
    expect(normaliseTransactions([mk('UPI/DR/412345678905/RAMESH KUMAR GENERAL/YESB/ramesh@ybl')])[0]!.merchant).toBe('Ramesh Kumar General');
    expect(normaliseTransactions([mk('UPI-ZOMATO LTD-zomato@hdfc-HDFC0000001-412345678906-PAY')])[0]!.merchant).toBe('Zomato');
  });

  it('is not fooled by a handle that contains a bank name', () => {
    expect(normaliseTransactions([mk('UPI/CR/412345678903/PRIYA NAIR/SBIN/priya@okaxis', 'credit')])[0]!.merchant).toBe('Priya Nair');
  });

  it('handles the other UPI layouts the parsers emit', () => {
    expect(normaliseTransactions([mk('UPI/P2M/412345678907/SWIGGY LIMITED')])[0]).toMatchObject({ merchant: 'Swiggy', upiRef: '412345678907' });
    expect(normaliseTransactions([mk('UPI/ZOMATO/412345678908/zomato@hdfc')])[0]).toMatchObject({ merchant: 'Zomato', upiRef: '412345678908' });
    expect(normaliseTransactions([mk('UPI/412345678909/BLINKIT/blinkit@yesbank/Payment')])[0]).toMatchObject({ merchant: 'Blinkit', upiRef: '412345678909' });
  });

  it('keeps a merchant and upiRef that are already set, and keeps channel when nothing matches', () => {
    const t = { ...mk('SOMETHING ODD 123'), merchant: 'Preset Co', upiRef: '999', channel: 'card' as const };
    const [n] = normaliseTransactions([t]);
    expect(n).toMatchObject({ merchant: 'Preset Co', upiRef: '999', channel: 'card' });
    const u = { ...mk('UPI/DR/412345678901/NETFLIX/hdfc/netflix@hdfc'), merchant: 'My Netflix', upiRef: '1' };
    expect(normaliseTransactions([u])[0]).toMatchObject({ merchant: 'My Netflix', upiRef: '1', channel: 'upi' });
  });

  it('recognises card statement lines and sets channel card on card accounts', () => {
    expect(normaliseTransactions([mk('SWIGGY BANGALORE IN', 'debit', 'hdfc-cc-4321')])[0]).toMatchObject({ merchant: 'Swiggy', channel: 'card' });
    expect(normaliseTransactions([mk('LATE PAYMENT FEE', 'debit', 'hdfc-cc-4321')])[0]).toMatchObject({ merchant: 'Bank charges', channel: 'fee' });
    expect(normaliseTransactions([mk('EMI 3/12 CROMA ELECTRONICS PUNE', 'debit', 'hdfc-cc-4321')])[0]).toMatchObject({ merchant: 'Croma', channel: 'emi' });
  });

  it('does not treat a refund credit as a fee', () => {
    expect(normaliseTransactions([mk('REVERSAL OF SMS CHARGES', 'credit')])[0]!.channel).not.toBe('fee');
  });

  it('recognises cheques and RTGS', () => {
    expect(normaliseTransactions([mk('CHQ PAID 000123 TO LANDLORD')])[0]!.channel).toBe('cheque');
    expect(normaliseTransactions([mk('RTGS DR-HDFC0000001-GREEN HOMES LLP-RENT')])[0]).toMatchObject({ channel: 'rtgs', merchant: 'Green Homes Llp' });
  });
});

describe('matchMerchant', () => {
  it('matches on word boundaries only', () => {
    expect(matchMerchant('rahul@okaxis')).toBeNull();
    expect(matchMerchant('NETFLIX COM MUMBAI')).toMatchObject({ name: 'Netflix', category: 'subscriptions' });
    expect(matchMerchant('SWIGGY INSTAMART')).toMatchObject({ name: 'Swiggy Instamart' });
    expect(matchMerchant('HDFC LIFE PREMIUM')).toMatchObject({ name: 'HDFC Life' });
  });
});
