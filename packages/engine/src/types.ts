/**
 * OpenPaisa engine contract.
 *
 * This file is the shared interface between the parsers, the analysers and
 * every UI (web, Android, chat skill). Change it only in a dedicated PR.
 *
 * Conventions:
 * - Money is an integer number of paise (₹1 = 100). Never use floats for money.
 * - Dates are ISO calendar dates "YYYY-MM-DD" (Asia/Kolkata local date).
 * - The engine is pure: no I/O, no network, no clock reads except via `asOf`.
 */

export type Paise = number;
export type IsoDate = string;

export type Direction = 'debit' | 'credit';

export type InstrumentKind = 'savings' | 'current' | 'credit_card' | 'loan' | 'wallet' | 'cash' | 'unknown';

export type Source = 'statement_pdf' | 'statement_csv' | 'email' | 'sms' | 'notification' | 'manual';

export type Channel = 'upi' | 'card' | 'neft' | 'imps' | 'rtgs' | 'nach' | 'atm' | 'cheque' | 'interest' | 'fee' | 'emi' | 'other';

export type Category =
  | 'rent' | 'emi' | 'groceries' | 'food_delivery' | 'dining' | 'shopping' | 'travel' | 'fuel'
  | 'utilities' | 'telecom' | 'subscriptions' | 'insurance' | 'investments' | 'education'
  | 'health' | 'entertainment' | 'transfers' | 'fees_charges' | 'taxes' | 'salary' | 'refund'
  | 'interest' | 'cash_withdrawal' | 'card_payment' | 'other';

export interface Account {
  id: string;                 // stable local id, e.g. "hdfc-sav-1234"
  institution: string;        // "HDFC Bank"
  kind: InstrumentKind;
  last4?: string;
  creditLimit?: Paise;        // credit cards
}

export interface Transaction {
  id: string;                 // deterministic hash of (accountId, date, amount, direction, rawDescription, seq)
  accountId: string;
  date: IsoDate;
  amount: Paise;              // always positive; see `direction`
  direction: Direction;
  rawDescription: string;     // exactly as on the statement
  merchant?: string;          // normalised payee/merchant, e.g. "Netflix"
  channel: Channel;
  upiRef?: string;            // UPI RRN / ref no when present
  category?: Category;
  balanceAfter?: Paise;
  source: Source;
  confidence: number;         // 0..1, parser confidence
}

/** Output of a statement parser. */
export interface ParsedStatement {
  account: Account;
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  openingBalance?: Paise;
  closingBalance?: Paise;
  /** Credit card statements only. */
  card?: {
    totalDue: Paise;
    minimumDue: Paise;
    dueDate: IsoDate;
    statementDate?: IsoDate;
  };
  transactions: Transaction[];
  warnings: string[];         // lines the parser could not understand, etc.
}

/**
 * A statement parser takes text already extracted from a PDF/CSV (the UI does
 * extraction and password unlocking locally) and returns a ParsedStatement.
 */
export interface StatementParser {
  id: string;                         // "hdfc-savings-pdf"
  institution: string;
  /** Cheap check on the first page of text; return 0..1. */
  detect(text: string): number;
  parse(text: string): ParsedStatement;
}

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export interface RecurringPayment {
  id: string;
  merchant: string;
  category: Category;
  frequency: Frequency;
  typicalAmount: Paise;
  annualCost: Paise;
  lastDate: IsoDate;
  nextExpectedDate: IsoDate;
  occurrences: string[];              // transaction ids
  kind: 'subscription' | 'emi' | 'sip' | 'insurance' | 'utility' | 'rent' | 'other';
  priceChange?: { from: Paise; to: Paise; on: IsoDate };
  possiblyForgotten: boolean;         // e.g. no related usage signals, duplicate service, long-running small charge
  confidence: number;
}

export interface Loan {
  id: string;
  lender: string;
  kind: 'home' | 'car' | 'personal' | 'education' | 'card_emi' | 'consumer_durable' | 'other';
  emi: Paise;
  principal?: Paise;                  // original
  annualRatePct?: number;             // e.g. 8.75
  tenureMonths?: number;
  startDate?: IsoDate;
  isFloating?: boolean;
  outstanding?: Paise;
  emiTransactionIds: string[];
  confidence: number;
}

export interface AmortisationRow {
  month: number;
  date: IsoDate;
  emi: Paise;
  interest: Paise;
  principal: Paise;
  outstanding: Paise;
}

export interface PrepaymentResult {
  prepayment: Paise;
  mode: 'reduce_tenure' | 'reduce_emi';
  interestSaved: Paise;
  monthsSaved: number;
  newEmi: Paise;
}

export type InsightKind =
  | 'forgotten_subscription' | 'duplicate_subscription' | 'price_increase'
  | 'fee_paid' | 'card_interest' | 'late_fee' | 'forex_markup'
  | 'loan_rate_reset' | 'prepayment_opportunity'
  | 'card_due_soon' | 'high_utilisation'
  | 'unknown_debit' | 'duplicate_charge'
  | 'idle_cash' | 'low_runway' | 'lumpy_expense_ahead';

/**
 * Insights state facts and arithmetic only. They never recommend a specific
 * investment or insurance product (see docs/PRD.md, "Guardrail on advice").
 */
export interface Insight {
  id: string;
  kind: InsightKind;
  severity: 'info' | 'warn' | 'act';
  title: string;                      // "You paid ₹1,180 in late fees this year"
  detail: string;
  annualImpact?: Paise;               // rupee value used to rank and to compute the headline
  transactionIds: string[];
  action?: { label: string; kind: 'cancel' | 'call_bank' | 'letter' | 'pay' | 'review' };
}

export interface MonthlyFlow {
  cycleStart: IsoDate;                // salary-cycle start (falls back to calendar month)
  income: Paise;
  spend: Paise;
  byCategory: Partial<Record<Category, Paise>>;
}

export interface UpcomingOutflow {
  date: IsoDate;
  label: string;
  amount: Paise;
  source: 'recurring' | 'card_due' | 'emi';
}

export interface CardSummary {
  accountId: string;
  totalDue: Paise;
  minimumDue: Paise;
  dueDate: IsoDate;
  statementDate?: IsoDate;
  creditLimit?: Paise;
  utilisationPct?: number;            // totalDue / creditLimit * 100, 1 dp
}

export interface AuditInput {
  statements: ParsedStatement[];
  asOf: IsoDate;
  /** Optional user-supplied facts the statements cannot show. */
  loans?: Partial<Loan>[];
  salaryDay?: number;                 // 1..31
}

export interface AuditReport {
  asOf: IsoDate;
  accounts: Account[];
  transactions: Transaction[];        // de-duplicated, categorised
  recurring: RecurringPayment[];
  loans: Loan[];
  insights: Insight[];                // sorted by annualImpact desc, then severity
  headline: { annualLeak: Paise; recurringAnnual: Paise; emiMonthly: Paise };
  flows: MonthlyFlow[];
  upcoming: UpcomingOutflow[];        // next 45 days
  cards: CardSummary[];               // latest statement per credit card
  safeToSpend?: { untilDate: IsoDate; amount: Paise };
}
