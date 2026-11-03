import { describe, expect, it } from 'vitest';
import { categoriseTransactions } from '../src/categorise.js';
import { normaliseTransactions } from '../src/normalise.js';
import { MERCHANTS } from '../src/parsers/merchants.js';
import { makeTransaction } from '../src/parsers/common.js';
import type { Category, Direction, Transaction } from '../src/types.js';

const mk = (rawDescription: string, direction: Direction = 'debit', accountId = 'hdfc-sav-1234'): Transaction =>
  makeTransaction({ accountId, date: '2026-10-05', amount: 100000, direction, rawDescription, seq: 0 });
const cat = (raw: string, direction: Direction = 'debit', accountId = 'hdfc-sav-1234'): Category | undefined =>
  categoriseTransactions(normaliseTransactions([mk(raw, direction, accountId)]))[0]!.category;

describe('merchant dictionary', () => {
  it('has at least 200 entries with unique names and valid patterns', () => {
    expect(MERCHANTS.length).toBeGreaterThanOrEqual(200);
    expect(new Set(MERCHANTS.map((m) => m.name)).size).toBe(MERCHANTS.length);
    expect(MERCHANTS.every((m) => m.patterns.length > 0)).toBe(true);
  });
});

describe('categorise: dictionary spot checks', () => {
  const cases: [string, Category][] = [
    ['UPI-SWIGGY LIMITED-swiggy.rzp@icici-ICIC0000001-412345678902-PAYMENT', 'food_delivery'],
    ['UPI/DR/412345678911/ZOMATO/hdfc/zomato@hdfc', 'food_delivery'],
    ['UPI/DR/412345678912/BLINKIT/yesb/blinkit@yesbank', 'groceries'],
    ['UPI/DR/412345678913/ZEPTO/axis/zepto@axisbank', 'groceries'],
    ['UPI/DR/412345678914/BIGBASKET/icici/bb@icici', 'groceries'],
    ['UPI/DR/412345678915/SWIGGY INSTAMART/icici/swiggy@icici', 'groceries'],
    ['POS 4321XXXXXXXX1234 AMAZON PAY INDIA', 'shopping'],
    ['UPI/DR/412345678916/FLIPKART/axis/flipkart@axisbank', 'shopping'],
    ['UPI/DR/412345678917/MYNTRA/hdfc/myntra@hdfc', 'shopping'],
    ['UPI/DR/412345678918/JIO/hdfc/jio@hdfc', 'telecom'],
    ['UPI/DR/412345678919/AIRTEL/axis/airtel@axisbank', 'telecom'],
    ['UPI/DR/412345678920/VI PREPAID/icici/vi@icici', 'telecom'],
    ['UPI/DR/412345678901/NETFLIX/hdfc/netflix@hdfc', 'subscriptions'],
    ['UPI/DR/412345678921/SPOTIFY/hdfc/spotify@hdfc', 'subscriptions'],
    ['UPI/DR/412345678922/HOTSTAR/hdfc/hotstar@hdfc', 'subscriptions'],
    ['UPI/DR/412345678923/AMAZON PRIME/hdfc/amazon@apl', 'subscriptions'],
    ['UPI/DR/412345678924/YOUTUBE PREMIUM/hdfc/google@okhdfc', 'subscriptions'],
    ['LIC OF INDIA PREMIUM', 'insurance'],
    ['HDFC LIFE INSURANCE', 'insurance'],
    ['UPI/DR/412345678925/STAR HEALTH/hdfc/star@hdfc', 'insurance'],
    ['UPI/DR/412345678926/ZERODHA/hdfc/zerodha@hdfc', 'investments'],
    ['UPI/DR/412345678927/GROWW/hdfc/groww@hdfc', 'investments'],
    ['ACH D- BSE LIMITED-SIP', 'investments'],
    ['IRCTC WEB PAYMENT NEW DELHI', 'travel'],
    ['UPI/DR/412345678928/UBER INDIA/axis/uber@axisbank', 'travel'],
    ['UPI/DR/412345678929/MAKEMYTRIP/hdfc/mmt@hdfc', 'travel'],
    ['UPI/DR/412345678930/BESCOM/hdfc/bescom@hdfc', 'utilities'],
    ['UPI/DR/412345678931/TATA POWER/hdfc/tata@hdfc', 'utilities'],
    ['POS 4321XXXXXXXX1234 IOCL PETROL PUMP', 'fuel'],
    ['POS 4321XXXXXXXX1234 HPCL FILLING STATION', 'fuel'],
    ['UPI/DR/412345678932/BOOKMYSHOW/hdfc/bms@hdfc', 'entertainment'],
    ['UPI/DR/412345678933/APOLLO PHARMACY/hdfc/apollo@hdfc', 'health'],
    ['UPI/DR/412345678934/DOMINOS PIZZA/hdfc/dominos@hdfc', 'dining'],
    ['UPI/DR/412345678935/UNACADEMY/hdfc/una@hdfc', 'education'],
    ['ACH D- BAJAJ FINANCE LTD-EMI 4567', 'emi'],
  ];
  it.each(cases)('%s -> %s', (raw, expected) => {
    expect(cat(raw)).toBe(expected);
  });
});

describe('categorise: keyword rules', () => {
  it('salary on a credit', () => expect(cat('NEFT CR-ACME TECH PVT LTD-SALARY OCT', 'credit')).toBe('salary'));
  it('interest credit', () => expect(cat('INT.PD:01-07-2026 TO 30-09-2026', 'credit')).toBe('interest'));
  it('fees and GST', () => {
    expect(cat('SMS CHARGES QTR')).toBe('fees_charges');
    expect(cat('LATE PAYMENT FEE', 'debit', 'hdfc-cc-4321')).toBe('fees_charges');
    expect(cat('IGST ON LATE PAYMENT FEE', 'debit', 'hdfc-cc-4321')).toBe('fees_charges');
    expect(cat('FINANCE CHARGES', 'debit', 'hdfc-cc-4321')).toBe('fees_charges');
  });
  it('emi and loan', () => {
    expect(cat('NACH/HDFCBANKLTD/LOAN 12345')).toBe('emi');
    expect(cat('EMI 3/12 SOME SHOP PUNE', 'debit', 'hdfc-cc-4321')).toBe('emi');
  });
  it('sip, bse, nse, mutual', () => {
    expect(cat('NACH/SOMETHING/SIP 8821')).toBe('investments');
    expect(cat('NSE CLEARING LTD')).toBe('investments');
    expect(cat('MUTUAL FUND PURCHASE')).toBe('investments');
  });
  it('atm', () => expect(cat('ATM WDL 12345 MG ROAD')).toBe('cash_withdrawal'));
  it('refund and reversal on a credit', () => {
    expect(cat('AMAZON PAY INDIA PVT LTD REFUND', 'credit', 'hdfc-cc-4321')).toBe('refund');
    expect(cat('REVERSAL OF SMS CHARGES', 'credit')).toBe('refund');
    expect(cat('UPI/CR/412345678936/SWIGGY/hdfc/swiggy@hdfc', 'credit')).toBe('refund');
  });
  it('payment received on a card account is a card payment, not income', () => {
    expect(cat('PAYMENT RECEIVED - THANK YOU', 'credit', 'icici-cc-5678')).toBe('card_payment');
  });
  it('person-to-person UPI, IMPS and NEFT are transfers', () => {
    expect(cat('UPI/CR/412345678903/RAHUL SHARMA/SBIN/rahul@okaxis', 'credit')).toBe('transfers');
    expect(cat('IMPS/P2A/412345678904/MOM')).toBe('transfers');
    expect(cat('UPI/P2P/412345678905/RAHUL SHARMA/SBIN/rahul@okaxis')).toBe('transfers');
  });
  it('an unrecognised UPI/IMPS/NEFT/RTGS debit is spend, a credit from a person is a transfer (A-r1-01)', () => {
    expect(cat('UPI/P2M/412345678901/RAMESH STORES/sbin/ramesh@oksbi')).toBe('other');
    expect(cat('UPI/DR/412345678903/RAHUL SHARMA/SBIN/rahul@okaxis')).toBe('other');
    expect(cat('UPI/CR/412345678903/RAHUL SHARMA/SBIN/rahul@okaxis', 'credit')).toBe('transfers');
    expect(cat('NEFT DR-HDFC0000001-GREEN HOMES')).toBe('other');
    expect(cat('RTGS CR-HDFC0000001-GREEN HOMES', 'credit')).toBe('transfers');
  });
  it('CRED card-bill payments are not subscriptions (A-r1-04)', () => {
    const raw = 'UPI-CRED CLUB-cred.club@axisb-UTIB0000100-412345678901-Payment';
    const out = categoriseTransactions(normaliseTransactions([{ ...mk(raw), amount: 3200000 }]))[0]!;
    expect(out.merchant).toBe('Card payment');
    expect(out.category).toBe('other');
    expect(out.channel).toBe('upi');
    expect(out.upiRef).toBe('412345678901');
    expect(cat('CRED')).not.toBe('subscriptions');
    expect(cat('NACH DR-DREAMPLUG TECHNOLOGIES')).not.toBe('subscriptions');
  });
  it('rent', () => expect(cat('NEFT DR-HDFC0000001-GREEN HOMES-RENT NOV')).toBe('rent'));
  it('falls back to other', () => expect(cat('SOMETHING UNREADABLE 77')).toBe('other'));
});

describe('categorise: precedence', () => {
  it('overrides beat the dictionary', () => {
    const [t] = normaliseTransactions([mk('UPI/DR/412345678901/NETFLIX/hdfc/netflix@hdfc')]);
    expect(categoriseTransactions([t!], { Netflix: 'entertainment' })[0]!.category).toBe('entertainment');
  });
  it('overrides beat an existing category', () => {
    const t = { ...mk('x'), merchant: 'Acme', category: 'card_payment' as const };
    expect(categoriseTransactions([t], { Acme: 'rent' })[0]!.category).toBe('rent');
  });
  it('keeps an existing category such as card_payment', () => {
    const t = { ...mk('CREDIT CARD PAYMENT'), category: 'card_payment' as const };
    expect(categoriseTransactions([t])[0]!.category).toBe('card_payment');
  });
  it('does not mutate its input and keeps other fields', () => {
    const t = mk('SMS CHARGES QTR');
    const [o] = categoriseTransactions([t]);
    expect(t.category).toBeUndefined();
    expect(o).toMatchObject({ id: t.id, amount: t.amount });
  });
  it('uses a merchant that is already set', () => {
    const t = { ...mk('ANYTHING'), merchant: 'Swiggy' };
    expect(categoriseTransactions([t])[0]!.category).toBe('food_delivery');
  });
});

describe('categorise: salary and bank-transfer credits (A-r2-01)', () => {
  it.each(['AMAZON DEVELOPMENT CENTRE INDIA', 'FLIPKART INTERNET PVT LTD', 'SWIGGY LIMITED', 'MICROSOFT INDIA', 'HDFC LIFE INSURANCE', 'ZERODHA BROKING'])(
    'a salary credit from %s is salary', (employer) => {
      expect(cat(`NEFT CR-HDFC0000001-${employer}-SALARY OCT N245678901`, 'credit')).toBe('salary');
    });
  it('a bank transfer credit from a merchant-dictionary company is not a refund', () => {
    expect(cat('NEFT CR-HDFC0000001-AMAZON DEVELOPMENT CENTRE INDIA-OCT N245678901', 'credit')).not.toBe('refund');
  });
  it('a UPI merchant credit is still a refund', () => {
    expect(cat('UPI/CR/412345678901/SWIGGY/yesb/swiggy@yesbank', 'credit')).toBe('refund');
  });
  it('an override still beats the salary rule', () => {
    const t = normaliseTransactions([mk('NEFT CR-HDFC0000001-AMAZON DEVELOPMENT CENTRE INDIA-SALARY OCT N1', 'credit')]);
    expect(categoriseTransactions(t, { Amazon: 'shopping' })[0]!.category).toBe('shopping');
  });
});
