import { describe, expect, it } from 'vitest';
import { dedupeTransactions } from '../src/dedupe.js';
import { makeTransaction } from '../src/parsers/common.js';
import type { Direction, Source, Transaction } from '../src/types.js';

function tx(p: Partial<Transaction> & { date?: string; amount?: number; direction?: Direction; rawDescription?: string; seq?: number; source?: Source; accountId?: string }): Transaction {
  const { seq = 0, ...rest } = p;
  const base = makeTransaction({
    accountId: rest.accountId ?? 'hdfc-sav-1234',
    date: rest.date ?? '2026-10-05',
    amount: rest.amount ?? 64900,
    direction: rest.direction ?? 'debit',
    rawDescription: rest.rawDescription ?? 'UPI/DR/412345678901/NETFLIX',
    seq,
    source: rest.source ?? 'statement_pdf',
  });
  return { ...base, ...rest, id: rest.id ?? base.id };
}

describe('dedupeTransactions', () => {
  it('keeps one row for a shared upiRef across sources, preferring the statement', () => {
    const sms = tx({ source: 'sms', upiRef: '412345678901', id: 'sms1', rawDescription: 'Rs 649 debited NETFLIX' });
    const pdf = tx({ source: 'statement_pdf', upiRef: '412345678901' });
    const out = dedupeTransactions([sms, pdf]);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('statement_pdf');
    expect(dedupeTransactions([pdf, sms])[0]!.source).toBe('statement_pdf');
  });

  it('keeps a UPI debit and its reversal credit that share an upiRef', () => {
    const debit = tx({ upiRef: '412345678901', source: 'sms', id: 'd' });
    const credit = tx({ upiRef: '412345678901', source: 'statement_pdf', direction: 'credit', rawDescription: 'UPI/CR/412345678901/REVERSAL' });
    expect(dedupeTransactions([debit, credit])).toHaveLength(2);
  });

  it('does not merge a shared upiRef when the amounts differ', () => {
    const a = tx({ upiRef: '412345678901', source: 'sms', id: 'a' });
    const b = tx({ upiRef: '412345678901', amount: 12300 });
    expect(dedupeTransactions([a, b])).toHaveLength(2);
  });

  it('merges same amount, direction and merchant within 2 days across sources and keeps the csv row', () => {
    const email = tx({ source: 'email', merchant: 'Netflix', date: '2026-10-05', id: 'e' });
    const csv = tx({ source: 'statement_csv', merchant: 'Netflix', date: '2026-10-06', rawDescription: 'NETFLIX COM', id: 'c' });
    const out = dedupeTransactions([email, csv]);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('statement_csv');
  });

  it('keeps both when the dates are 3 days apart', () => {
    const email = tx({ source: 'email', merchant: 'Netflix', date: '2026-10-05', id: 'e' });
    const csv = tx({ source: 'statement_csv', merchant: 'Netflix', date: '2026-10-08', id: 'c' });
    expect(dedupeTransactions([email, csv])).toHaveLength(2);
  });

  it('does not merge different merchants or two rows from the same source', () => {
    const a = tx({ source: 'email', merchant: 'Netflix', id: 'a' });
    const b = tx({ source: 'statement_csv', merchant: 'Spotify', id: 'b' });
    expect(dedupeTransactions([a, b])).toHaveLength(2);
    const c = tx({ source: 'statement_csv', merchant: 'Netflix', date: '2026-10-06', id: 'c' });
    const d = tx({ source: 'statement_csv', merchant: 'Netflix', date: '2026-10-06', id: 'd' });
    expect(dedupeTransactions([c, d])).toHaveLength(2);
  });

  it('prefers sources in the order pdf > csv > email > sms > notification > manual', () => {
    const rows = (['manual', 'notification', 'sms', 'email', 'statement_csv', 'statement_pdf'] as Source[]).map((source) =>
      tx({ source, merchant: 'Netflix', id: source }),
    );
    const out = dedupeTransactions(rows);
    expect(out.map((t) => t.source)).toEqual(['statement_pdf']);
  });

  it('collapses the same statement uploaded twice (identical rows have identical ids)', () => {
    const once = [tx({ seq: 0 }), tx({ seq: 0, date: '2026-10-06', amount: 1000, rawDescription: 'ATM' })];
    const twice = [...once, ...once.map((t) => ({ ...t }))];
    expect(dedupeTransactions(twice)).toHaveLength(2);
  });

  it('keeps two genuine identical rows from one statement (different seq)', () => {
    const a = tx({ seq: 0, merchant: 'Swiggy', rawDescription: 'SWIGGY' });
    const b = tx({ seq: 1, merchant: 'Swiggy', rawDescription: 'SWIGGY' });
    expect(a.id).not.toBe(b.id);
    expect(dedupeTransactions([a, b])).toHaveLength(2);
  });

  it('keeps overlapping periods consistent: the shared rows collapse, the rest stay', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => tx({ date: `2026-10-0${i + 1}`, amount: 1000 + i, rawDescription: `ROW ${i}` }));
    const first = rows(5);
    const second = rows(5).slice(2).concat([tx({ date: '2026-10-09', amount: 5555, rawDescription: 'NEW' })]);
    expect(dedupeTransactions([...first, ...second])).toHaveLength(6);
  });

  it('marks both sides of a matched card-bill payment as card_payment and keeps both', () => {
    const debit = tx({ rawDescription: 'CREDIT CARD PAYMENT-XXXXXX5678', amount: 1200000, date: '2026-10-18' });
    const credit = tx({ accountId: 'icici-cc-5678', direction: 'credit', rawDescription: 'PAYMENT RECEIVED - THANK YOU', amount: 1200000, date: '2026-10-19' });
    const out = dedupeTransactions([credit, debit]);
    expect(out).toHaveLength(2);
    expect(out.every((t) => t.category === 'card_payment')).toBe(true);
  });

  it('does not mark a card payment when nothing matches', () => {
    const debit = tx({ rawDescription: 'CREDIT CARD PAYMENT-XXXXXX5678', amount: 1200000, date: '2026-10-18' });
    const credit = tx({ accountId: 'icici-cc-5678', direction: 'credit', rawDescription: 'PAYMENT RECEIVED - THANK YOU', amount: 1250000, date: '2026-10-19' });
    const out = dedupeTransactions([debit, credit]);
    expect(out.some((t) => t.category === 'card_payment')).toBe(false);
  });

  it('matches each payment to one bill payment only', () => {
    const d1 = tx({ rawDescription: 'CREDIT CARD PAYMENT', amount: 500000, date: '2026-10-10', seq: 0 });
    const d2 = tx({ rawDescription: 'CREDIT CARD PAYMENT', amount: 500000, date: '2026-10-11', seq: 1 });
    const c1 = tx({ accountId: 'hdfc-cc-4321', direction: 'credit', rawDescription: 'PAYMENT RECEIVED', amount: 500000, date: '2026-10-12' });
    const out = dedupeTransactions([d1, d2, c1]);
    expect(out.filter((t) => t.category === 'card_payment')).toHaveLength(2);
  });

  it('sorts by date ascending and is stable for equal dates', () => {
    const a = tx({ date: '2026-10-09', rawDescription: 'A', amount: 1 });
    const b = tx({ date: '2026-10-01', rawDescription: 'B', amount: 2 });
    const c = tx({ date: '2026-10-09', rawDescription: 'C', amount: 3 });
    expect(dedupeTransactions([a, b, c]).map((t) => t.rawDescription)).toEqual(['B', 'A', 'C']);
  });

  it('does not mutate its input', () => {
    const debit = tx({ rawDescription: 'CREDIT CARD PAYMENT', amount: 1000 });
    const credit = tx({ accountId: 'hdfc-cc-1', direction: 'credit', rawDescription: 'PAYMENT RECEIVED', amount: 1000 });
    dedupeTransactions([debit, credit]);
    expect(debit.category).toBeUndefined();
  });

  describe('own-account transfers (A-r1-01)', () => {
    const neftOut = (extra: Partial<Transaction> = {}) => tx({ accountId: 'hdfc-sav-1234', date: '2026-10-05', amount: 5000000, direction: 'debit', rawDescription: 'NEFT DR-ICIC0000001-SELF', channel: 'neft', ...extra });
    const neftIn = (extra: Partial<Transaction> = {}) => tx({ accountId: 'icici-sav-5678', date: '2026-10-06', amount: 5000000, direction: 'credit', rawDescription: 'NEFT CR-HDFC0000001-RAJ KUMAR', channel: 'neft', ...extra });
    it('pairs a debit with the same-amount credit on another account the next day', () => {
      const out = dedupeTransactions([neftOut(), neftIn()]);
      expect(out.map((t) => t.category)).toEqual(['transfers', 'transfers']);
    });
    it('pairs when the credit is dated a day before the debit', () => {
      const out = dedupeTransactions([neftOut(), neftIn({ date: '2026-10-04' })]);
      expect(out.map((t) => t.category)).toEqual(['transfers', 'transfers']);
    });
    it('leaves a lone debit alone', () => {
      expect(dedupeTransactions([neftOut()])[0]!.category).toBeUndefined();
    });
    it('does not pair across more than 2 days, the same account, differing amounts or card accounts', () => {
      expect(dedupeTransactions([neftOut(), neftIn({ date: '2026-10-09' })]).every((t) => !t.category)).toBe(true);
      expect(dedupeTransactions([neftOut(), neftIn({ accountId: 'hdfc-sav-1234' })]).every((t) => !t.category)).toBe(true);
      expect(dedupeTransactions([neftOut(), neftIn({ amount: 4999900 })]).every((t) => !t.category)).toBe(true);
      expect(dedupeTransactions([neftOut(), neftIn({ accountId: 'icici-cc-5678' })]).every((t) => !t.category)).toBe(true);
    });
    it('pairs each row at most once', () => {
      const out = dedupeTransactions([neftOut(), neftOut({ id: 'x2', date: '2026-10-05' }), neftIn()]);
      expect(out.filter((t) => t.category === 'transfers')).toHaveLength(2);
    });
    it('pairs on a SELF narration without a transfer channel', () => {
      const out = dedupeTransactions([
        tx({ rawDescription: 'FUND TRANSFER TO SELF', amount: 100000 }),
        tx({ accountId: 'sbi-sav-9999', direction: 'credit', rawDescription: 'OWN ACCOUNT CREDIT', amount: 100000, date: '2026-10-05' }),
      ]);
      expect(out.map((t) => t.category)).toEqual(['transfers', 'transfers']);
    });
    it('does not pair unrelated same-amount rows on different accounts (A-r2-03)', () => {
      const credit = tx({ accountId: 'hdfc-sav-1234', date: '2026-10-03', amount: 5000000, direction: 'credit', rawDescription: 'IMPS/P2A/412345678901/RAHUL SHARMA', channel: 'imps' });
      const rent = tx({ accountId: 'icici-sav-5678', date: '2026-10-04', amount: 5000000, direction: 'debit', rawDescription: 'NEFT DR-ICIC0000001-GREEN HOMES LLP-RENT', channel: 'neft', category: 'rent' });
      const out = dedupeTransactions([credit, rent]);
      expect(out.map((t) => t.category)).toEqual([undefined, 'rent']);
      expect(dedupeTransactions([neftOut({ rawDescription: 'NEFT DR-ICIC0000001-ARJUN' }), neftIn()]).every((t) => !t.category)).toBe(true);
    });
    it('pairs a SELF debit with a next-day credit on another account', () => {
      const out = dedupeTransactions([neftOut({ rawDescription: 'NEFT DR-HDFC0000001-ARJUN MEHTA-SELF' }), neftIn({ rawDescription: 'NEFT CR-HDFC0000001-ARJUN MEHTA' })]);
      expect(out.map((t) => t.category)).toEqual(['transfers', 'transfers']);
    });
    it("pairs when the debit names the other account's last four", () => {
      const out = dedupeTransactions([neftOut({ rawDescription: 'NEFT DR-ICIC0000001-XXXXXX5678' }), neftIn()]);
      expect(out.map((t) => t.category)).toEqual(['transfers', 'transfers']);
    });
    it('never re-labels a salary credit or a rent debit, even with a signal', () => {
      const salary = neftIn({ rawDescription: 'NEFT CR-HDFC0000001-ACME-SALARY OCT', category: 'salary' });
      expect(dedupeTransactions([neftOut(), salary]).map((t) => t.category)).toEqual([undefined, 'salary']);
      const rent = neftOut({ rawDescription: 'NEFT DR-ICIC0000001-XXXXXX5678-RENT', category: 'rent' });
      expect(dedupeTransactions([rent, neftIn()]).map((t) => t.category)).toEqual(['rent', undefined]);
    });
    it('never re-marks card_payment rows', () => {
      const debit = tx({ rawDescription: 'CREDIT CARD PAYMENT NEFT', channel: 'neft', amount: 1120000 });
      const cardCredit = tx({ accountId: 'axis-cc-2468', direction: 'credit', rawDescription: 'PAYMENT RECEIVED', amount: 1120000, date: '2026-10-06' });
      const other = tx({ accountId: 'icici-sav-5678', direction: 'credit', rawDescription: 'NEFT CR-X', channel: 'neft', amount: 1120000, date: '2026-10-06' });
      const out = dedupeTransactions([debit, other, cardCredit]);
      expect(out.find((t) => t.id === debit.id)!.category).toBe('card_payment');
      expect(out.find((t) => t.id === other.id)!.category).toBeUndefined();
    });
    it('treats a CRED payment as a card-bill debit', () => {
      const debit = tx({ rawDescription: 'UPI-CRED CLUB-cred.club@axisb-UTIB0000100-412345678901-Payment', amount: 3200000 });
      const credit = tx({ accountId: 'hdfc-cc-4321', direction: 'credit', rawDescription: 'PAYMENT RECEIVED - THANK YOU', amount: 3200000, date: '2026-10-06' });
      expect(dedupeTransactions([debit, credit]).map((t) => t.category)).toEqual(['card_payment', 'card_payment']);
    });
  });
});
