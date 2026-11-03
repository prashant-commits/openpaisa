import { addMonths } from '../src/dates.js';
import type { Account, AuditInput, IsoDate, ParsedStatement, Transaction } from '../src/types.js';

let seq = 0;

/** Reset the id counter (tests that compare two runs need determinism). */
export function resetBuilders(): void {
  seq = 0;
}

type TxnInput = Partial<Omit<Transaction, 'amount'>> & { date: IsoDate; amount: number /* rupees */ };

/**
 * Synthetic transaction. `amount` is in rupees. merchant is set explicitly and
 * rawDescription embeds the unique id, so no UPI ref is ever shared between rows.
 */
export function txn(p: TxnInput): Transaction {
  seq += 1;
  const { amount, ...rest } = p;
  const id = rest.id ?? `t${String(seq).padStart(5, '0')}`;
  return {
    id,
    accountId: 'hdfc-sav-1234',
    direction: 'debit',
    channel: 'upi',
    source: 'statement_pdf',
    confidence: 1,
    rawDescription: `${rest.merchant ?? 'TXN'} ${id}`,
    ...rest,
    amount: Math.round(amount * 100),
  };
}

/** `count` monthly debits of the same merchant/amount starting at `from` (month-end clamped from the first day-of-month). */
export function monthly(merchant: string, rupees: number, from: IsoDate, count: number, extra: Partial<Transaction> = {}): Transaction[] {
  const out: Transaction[] = [];
  for (let k = 0; k < count; k++) {
    out.push(txn({ date: addMonths(from, k), amount: rupees, merchant, ...extra }));
  }
  return out;
}

export function statement(account: Partial<Account>, txns: Transaction[], extra: Partial<ParsedStatement> = {}): ParsedStatement {
  const acc: Account = { id: 'hdfc-sav-1234', institution: 'HDFC Bank', kind: 'savings', ...account };
  return {
    account: acc,
    transactions: txns.map((t) => ({ ...t, accountId: acc.id })),
    warnings: [],
    ...extra,
  };
}

export type { AuditInput };
