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


/** Amounts (rupees) spread far enough apart that they never form an amount band. */
const FOOD = [240, 410, 680, 330, 520, 150, 860, 290, 470, 1100, 190, 590];
const GROCERY = [1250, 780, 2100, 940, 1600, 520, 3100, 1380, 700, 2500, 1100, 4200];

/**
 * Six months (May-Oct 2026) of an invented household, as of 2026-11-03.
 * HDFC savings plus an ICICI credit card. Deterministic: ids restart on each call.
 */
export function household(): AuditInput {
  resetBuilders();
  const m = (k: number, day: number): IsoDate => addMonths(`2026-05-${String(day).padStart(2, '0')}`, k);
  const sav: Transaction[] = [];
  const card: Transaction[] = [];
  const cc = 'icici-cc-5678';

  for (let k = 0; k < 6; k++) {
    sav.push(txn({ date: m(k, 1), amount: 120000, direction: 'credit', category: 'salary', merchant: 'Acme Pvt Ltd', channel: 'neft', rawDescription: `NEFT CR SALARY ACME PVT LTD ${k}` }));
    sav.push(txn({ date: m(k, 3), amount: 28000, category: 'rent', merchant: 'Landlord Mehta', rawDescription: `UPI RENT ${k}` }));
    sav.push(txn({ date: m(k, 5), amount: 43391.16, category: 'emi', merchant: 'HDFC Ltd', channel: 'nach', rawDescription: `NACH/HDFCBANKLTD/HOME LOAN ${k}` }));
    sav.push(txn({ date: m(k, 5), amount: 649, category: 'subscriptions', merchant: 'Netflix' }));
    sav.push(txn({ date: m(k, 7), amount: 299, category: 'subscriptions', merchant: 'Hotstar' }));
    sav.push(txn({ date: m(k, 9), amount: 129, category: 'subscriptions', merchant: 'Tiny App' }));
    sav.push(txn({ date: m(k, 7), amount: 25000, category: 'card_payment', merchant: 'ICICI Card', rawDescription: `CC PAYMENT ${k}` }));
    sav.push(txn({ date: m(k, 12), amount: FOOD[2 * k] as number, category: 'food_delivery', merchant: 'Swiggy' }));
    sav.push(txn({ date: m(k, 22), amount: FOOD[2 * k + 1] as number, category: 'food_delivery', merchant: 'Swiggy' }));
    sav.push(txn({ date: m(k, 14), amount: GROCERY[2 * k] as number, category: 'groceries', merchant: 'Blinkit' }));
    sav.push(txn({ date: m(k, 26), amount: GROCERY[2 * k + 1] as number, category: 'groceries', merchant: 'Blinkit' }));
    card.push(txn({ date: m(k, 16), amount: 1800 + 700 * k + 130 * k * k, category: 'shopping', merchant: ['Amazon', 'Myntra', 'Croma'][k % 3], accountId: cc, channel: 'card' }));
  }
  card.push(txn({ date: '2026-09-10', amount: 1000, category: 'fees_charges', rawDescription: 'LATE PAYMENT FEE', accountId: cc, channel: 'fee' }));
  card.push(txn({ date: '2026-09-10', amount: 180, category: 'fees_charges', rawDescription: 'IGST @18%', accountId: cc, channel: 'fee' }));
  card.push(txn({ date: '2026-08-20', amount: 350, category: 'fees_charges', rawDescription: 'FOREX MARKUP FEE INTL PURCHASE', accountId: cc, channel: 'fee' }));

  return {
    asOf: '2026-11-03',
    statements: [
      statement({ id: 'hdfc-sav-1234', institution: 'HDFC Bank', kind: 'savings', last4: '1234' }, sav, {
        periodStart: '2026-05-01', periodEnd: '2026-10-31', closingBalance: 25000000,
      }),
      statement({ id: cc, institution: 'ICICI Bank', kind: 'credit_card', last4: '5678', creditLimit: 10000000 }, card, {
        periodStart: '2026-05-01', periodEnd: '2026-10-31',
        card: { totalDue: 4200000, minimumDue: 210000, dueDate: '2026-11-08', statementDate: '2026-10-24' },
      }),
    ],
    loans: [{ lender: 'HDFC Ltd', principal: 500000000, annualRatePct: 8.5, tenureMonths: 240, startDate: '2025-11-05' }],
  };
}
