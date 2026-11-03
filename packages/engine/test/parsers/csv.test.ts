import { describe, expect, it } from 'vitest';
import { csvParser } from '../../src/parsers/csv.js';
import { parseStatement } from '../../src/parsers/index.js';
import hdfcSavings from '../fixtures/hdfc-savings.txt?raw';
import hdfcCard from '../fixtures/hdfc-card.txt?raw';

const simple = `Date,Description,Debit,Credit,Balance
01/11/2026,SALARY ACME TECH,,85000.00,185000.00
03/11/2026,"Amazon, Pay India",1299.50,,183700.50
04/11/2026,UPI/DR/412345678901/NETFLIX,649.00,,183051.50
04/11/2026,UPI/DR/412345678901/NETFLIX,649.00,,182402.50
`;

const hdfcStyle = `Txn Date,Value Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance
05/11/26,05/11/26,ACH D- BSE LIMITED-SIP,0000,"5,000.00",,"95,000.00"
06/11/26,06/11/26,NEFT CR-ACME,N1,,"1,00,000.00","1,95,000.00"
`;

const signed = `Statement for account XXXXXX1234
Generated on 03 Nov 2026

Date,Details,Amount,Dr/Cr
03 Nov 2026,Swiggy order,450.00,Dr
04 Nov 2026,Refund from Myntra,"1,200.00",Cr
05-Nov-2026,Plain rent,"(15,000.00)",
`;

describe('generic CSV parser', () => {
  it('has the expected identity', () => {
    expect(csvParser.id).toBe('generic-csv');
    expect(csvParser.institution).toBe('Unknown');
  });

  it('detects a header with a date and an amount column', () => {
    expect(csvParser.detect(simple)).toBeGreaterThanOrEqual(0.6);
    expect(csvParser.detect(hdfcStyle)).toBeGreaterThanOrEqual(0.6);
    expect(csvParser.detect(signed)).toBeGreaterThanOrEqual(0.6);
  });

  it('does not detect other text', () => {
    expect(csvParser.detect('hello world')).toBe(0);
    expect(csvParser.detect('Date,Description\n01/01/2026,Something')).toBe(0);
    expect(csvParser.detect(hdfcSavings)).toBe(0);
    expect(csvParser.detect(hdfcCard)).toBe(0);
  });

  it('parses Date,Description,Debit,Credit,Balance', () => {
    const s = csvParser.parse(simple);
    expect(s.account).toMatchObject({ institution: 'Unknown', kind: 'unknown' });
    expect(s.account.id).toMatch(/^csv-[0-9a-f]{8}$/);
    expect(s.transactions).toHaveLength(4);
    expect(s.transactions[0]).toMatchObject({ date: '2026-11-01', amount: 8500000, direction: 'credit', balanceAfter: 18500000, source: 'statement_csv', rawDescription: 'SALARY ACME TECH' });
    expect(s.transactions[1]).toMatchObject({ amount: 129950, direction: 'debit', rawDescription: 'Amazon, Pay India' });
    expect(s.periodStart).toBe('2026-11-01');
    expect(s.periodEnd).toBe('2026-11-04');
    expect(s.warnings).toEqual([]);
  });

  it('keeps two identical rows apart with different ids', () => {
    const s = csvParser.parse(simple);
    expect(s.transactions[2]!.id).not.toBe(s.transactions[3]!.id);
  });

  it('parses Txn Date / Narration / Withdrawal Amt / Deposit Amt / Closing Balance with quoted Indian amounts', () => {
    const s = csvParser.parse(hdfcStyle);
    expect(s.transactions).toHaveLength(2);
    expect(s.transactions[0]).toMatchObject({ date: '2026-11-05', amount: 500000, direction: 'debit', balanceAfter: 9500000 });
    expect(s.transactions[1]).toMatchObject({ date: '2026-11-06', amount: 10000000, direction: 'credit' });
  });

  it('parses a single Amount column with a Dr/Cr column or brackets, after title rows', () => {
    const s = csvParser.parse(signed);
    expect(s.transactions).toHaveLength(3);
    expect(s.transactions[0]).toMatchObject({ direction: 'debit', amount: 45000 });
    expect(s.transactions[1]).toMatchObject({ direction: 'credit', amount: 120000 });
    expect(s.transactions[2]).toMatchObject({ direction: 'debit', amount: 1500000 });
  });

  it('handles escaped quotes and CRLF line endings', () => {
    const s = csvParser.parse('Date,Description,Debit,Credit\r\n01/11/2026,"He said ""hi"", ok",10.00,\r\n');
    expect(s.transactions[0]!.rawDescription).toBe('He said "hi", ok');
    expect(s.transactions[0]!.amount).toBe(1000);
  });

  it('warns on a bad date and skips the row', () => {
    const s = csvParser.parse(simple + '31/02/2026,Bad row,1.00,,1.00\n');
    expect(s.transactions).toHaveLength(4);
    expect(s.warnings).toHaveLength(1);
  });

  it('returns no rows and a warning for a header-only file', () => {
    const s = csvParser.parse('Date,Description,Debit,Credit,Balance\n');
    expect(s.transactions).toEqual([]);
    expect(s.warnings.length).toBeGreaterThan(0);
  });

  it('is picked by parseStatement', () => {
    expect(parseStatement(simple).account.institution).toBe('Unknown');
  });
});
