/**
 * Hand-written, entirely synthetic AuditReport used for the "Try with sample
 * data" path and for tests. Every person, employer, handle and reference
 * number here is invented; account numbers are masked.
 */
import type {
  Account, AuditReport, CardSummary, Category, Channel, Insight, Loan, MonthlyFlow,
  Paise, RecurringPayment, Transaction, UpcomingOutflow,
} from '@openpaisa/engine';

const SAV = 'hdfc-sav-1234';
const CARD = 'icici-cc-5678';

const accounts: Account[] = [
  { id: SAV, institution: 'HDFC Bank', kind: 'savings', last4: '1234' },
  { id: CARD, institution: 'ICICI Bank', kind: 'credit_card', last4: '5678', creditLimit: 10_000_000 },
];

const transactions: Transaction[] = [];
const idsByTag: Record<string, string[]> = {};
let seq = 0;

function pad(n: number): string { return String(n).padStart(2, '0'); }

function add(
  tag: string | null, accountId: string, date: string, amount: Paise, direction: 'debit' | 'credit',
  rawDescription: string, merchant: string | undefined, channel: Channel, category: Category,
): void {
  seq += 1;
  const id = `sample-${String(seq).padStart(4, '0')}`;
  transactions.push({
    id, accountId, date, amount, direction, rawDescription, merchant, channel, category,
    upiRef: channel === 'upi' ? `6${String(10_000_000_00 + seq * 7919).slice(0, 11)}` : undefined,
    source: 'statement_pdf', confidence: 0.95,
  });
  if (tag) (idsByTag[tag] ??= []).push(id);
}

/** Small deterministic wobble so amounts look real without randomness. */
const wobble = (m: number, k: number, step: number, mod = 5): number => ((m * 7 + k * 13) % mod) * step;

for (let m = 0; m < 6; m++) {
  const month = 5 + m; // May..Oct 2026
  const d = (day: number): string => `2026-${pad(month)}-${pad(day)}`;
  // Savings account
  add(null, SAV, d(1), 12_000_000, 'credit', 'NEFT-ACME TECHNOLOGIES PVT LTD-SALARY', 'Acme Technologies', 'neft', 'salary');
  add('rent', SAV, d(5), 2_800_000, 'debit', 'UPI-MEERA NAIR-meera.nair@okbank-RENT', 'Meera Nair', 'upi', 'rent');
  add('emi', SAV, d(5), 4_339_116, 'debit', 'ACH D- SUNRISE HOUSING FIN-LOAN EMI', 'Sunrise Housing Finance', 'nach', 'emi');
  add('sip', SAV, d(7), 1_000_000, 'debit', 'ACH D- MUTUAL FUND SIP AUTO-DEBIT', 'Mutual fund SIP', 'nach', 'investments');
  add(null, SAV, d(3), 184_000 + wobble(m, 1, 6_500), 'debit', 'UPI-BIGBASKET-bigbasket@okpay-GROCERY', 'BigBasket', 'upi', 'groceries');
  add(null, SAV, d(17), 226_000 + wobble(m, 2, 7_200), 'debit', 'UPI-FRESHMART-freshmart@okpay-GROCERY', 'FreshMart', 'upi', 'groceries');
  add(null, SAV, d(26), 142_000 + wobble(m, 3, 4_100), 'debit', 'UPI-BIGBASKET-bigbasket@okpay-GROCERY', 'BigBasket', 'upi', 'groceries');
  add(null, SAV, d(9), 168_000 + wobble(m, 4, 9_000), 'debit', 'BILLDESK-STATE ELECTRICITY BOARD', 'State Electricity Board', 'other', 'utilities');
  if (m % 2 === 0) add(null, SAV, d(11), 500_000, 'debit', 'ATM-CASH WDL-XXXXXX1234', undefined, 'atm', 'cash_withdrawal');
  const cardPaid = 3_100_000 + wobble(m, 5, 150_000);
  add(null, SAV, d(25), cardPaid, 'debit', 'CC PAYMENT ICICI XXXXXX5678', 'ICICI Card', 'other', 'card_payment');
  add(null, CARD, d(25), cardPaid, 'credit', 'PAYMENT RECEIVED - THANK YOU', 'ICICI Card', 'other', 'card_payment');

  // Credit card
  add('netflix', CARD, d(12), m < 3 ? 49_900 : 64_900, 'debit', 'NETFLIX.COM MUMBAI', 'Netflix', 'card', 'subscriptions');
  add('hotstar', CARD, d(14), 29_900, 'debit', 'HOTSTAR SUBSCRIPTION MUMBAI', 'Hotstar', 'card', 'subscriptions');
  add('forgotten', CARD, d(20), 12_900, 'debit', 'QUICKNOTES PRO APP SUBSCRIPTION', 'QuickNotes Pro', 'card', 'subscriptions');
  const swiggy: [number, number][] = [[2, 38_400], [8, 52_100], [15, 44_900], [23, 61_300]];
  swiggy.forEach(([day, base], k) => {
    if (m === 4 && day === 8) { // Sep: the same order charged twice
      add('dupe', CARD, d(day), 49_900, 'debit', 'SWIGGY BANGALORE', 'Swiggy', 'card', 'food_delivery');
      add('dupe', CARD, d(day), 49_900, 'debit', 'SWIGGY BANGALORE', 'Swiggy', 'card', 'food_delivery');
    } else {
      add(null, CARD, d(day), base + wobble(m, k, 1_700), 'debit', 'SWIGGY BANGALORE', 'Swiggy', 'card', 'food_delivery');
    }
  });
  add(null, CARD, d(27), 182_000 + wobble(m, 6, 5_300), 'debit', 'CAFE BREW COMPANY PUNE', 'Cafe Brew Company', 'card', 'dining');
  add(null, CARD, d(10), 349_900 + wobble(m, 7, 21_000), 'debit', 'AMAZON PAY INDIA', 'Amazon', 'card', 'shopping');
  add(null, CARD, d(18), 64_000 + wobble(m, 8, 3_800), 'debit', 'UBER INDIA SYSTEMS', 'Uber', 'card', 'travel');
  add(null, CARD, d(21), 300_000 + wobble(m, 9, 12_000), 'debit', 'INDIAN OIL PETROL PUMP', 'Indian Oil', 'card', 'fuel');
}

// One-off charges that feed the insights.
add('forex_base', CARD, '2026-08-20', 1_200_000, 'debit', 'AMAZON.COM SEATTLE USD 142.00', 'Amazon.com', 'card', 'shopping');
add('forex', CARD, '2026-08-20', 42_000, 'debit', 'FOREX MARKUP FEE 3.5% + GST', 'Forex markup', 'fee', 'fees_charges');
add('fee', SAV, '2026-06-15', 59_000, 'debit', 'DEBIT CARD ANNUAL FEE INCL GST', 'HDFC Bank', 'fee', 'fees_charges');
add('late', CARD, '2026-09-28', 118_000, 'debit', 'LATE PAYMENT FEE INCL GST', 'ICICI Bank', 'fee', 'fees_charges');
add('interest', CARD, '2026-09-29', 84_250, 'debit', 'FINANCE CHARGES', 'ICICI Bank', 'interest', 'interest');

transactions.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));

const SKIP_SPEND: Category[] = ['card_payment'];

function buildFlows(): MonthlyFlow[] {
  const flows: MonthlyFlow[] = [];
  for (let month = 5; month <= 10; month++) {
    const start = `2026-${pad(month)}-01`;
    const end = `2026-${pad(month)}-31`;
    const flow: MonthlyFlow = { cycleStart: start, income: 0, spend: 0, byCategory: {} };
    for (const t of transactions) {
      if (t.date < start || t.date > end) continue;
      const cat = t.category ?? 'other';
      if (t.direction === 'credit') {
        if (cat === 'salary') flow.income += t.amount;
      } else if (!SKIP_SPEND.includes(cat)) {
        flow.spend += t.amount;
        flow.byCategory[cat] = (flow.byCategory[cat] ?? 0) + t.amount;
      }
    }
    flows.push(flow);
  }
  return flows;
}

const ids = (...tags: string[]): string[] => tags.flatMap((t) => idsByTag[t] ?? []);
const last = (tag: string): string => (idsByTag[tag] ?? [])[(idsByTag[tag]?.length ?? 1) - 1] ?? '';

const recurring: RecurringPayment[] = [
  {
    id: 'rec-netflix', merchant: 'Netflix', category: 'subscriptions', frequency: 'monthly',
    typicalAmount: 64_900, annualCost: 778_800, lastDate: '2026-10-12', nextExpectedDate: '2026-11-12',
    occurrences: ids('netflix'), kind: 'subscription',
    priceChange: { from: 49_900, to: 64_900, on: '2026-08-12' }, possiblyForgotten: false, confidence: 0.97,
  },
  {
    id: 'rec-hotstar', merchant: 'Hotstar', category: 'subscriptions', frequency: 'monthly',
    typicalAmount: 29_900, annualCost: 358_800, lastDate: '2026-10-14', nextExpectedDate: '2026-11-14',
    occurrences: ids('hotstar'), kind: 'subscription', possiblyForgotten: false, confidence: 0.96,
  },
  {
    id: 'rec-quicknotes', merchant: 'QuickNotes Pro', category: 'subscriptions', frequency: 'monthly',
    typicalAmount: 12_900, annualCost: 154_800, lastDate: '2026-10-20', nextExpectedDate: '2026-11-20',
    occurrences: ids('forgotten'), kind: 'subscription', possiblyForgotten: true, confidence: 0.9,
  },
  {
    id: 'rec-rent', merchant: 'Meera Nair', category: 'rent', frequency: 'monthly',
    typicalAmount: 2_800_000, annualCost: 33_600_000, lastDate: '2026-10-05', nextExpectedDate: '2026-11-05',
    occurrences: ids('rent'), kind: 'rent', possiblyForgotten: false, confidence: 0.93,
  },
  {
    id: 'rec-emi', merchant: 'Sunrise Housing Finance', category: 'emi', frequency: 'monthly',
    typicalAmount: 4_339_116, annualCost: 52_069_392, lastDate: '2026-10-05', nextExpectedDate: '2026-11-05',
    occurrences: ids('emi'), kind: 'emi', possiblyForgotten: false, confidence: 0.99,
  },
  {
    id: 'rec-sip', merchant: 'Mutual fund SIP', category: 'investments', frequency: 'monthly',
    typicalAmount: 1_000_000, annualCost: 12_000_000, lastDate: '2026-10-07', nextExpectedDate: '2026-11-07',
    occurrences: ids('sip'), kind: 'sip', possiblyForgotten: false, confidence: 0.98,
  },
];

const loans: Loan[] = [{
  id: 'loan-home-1', lender: 'Sunrise Housing Finance', kind: 'home', emi: 4_339_116,
  principal: 500_000_000, annualRatePct: 8.5, tenureMonths: 240, startDate: '2025-11-05',
  isFloating: true, outstanding: 490_048_857, emiTransactionIds: ids('emi'), confidence: 0.95,
}];

const insights: Insight[] = [
  {
    id: 'ins-netflix-price', kind: 'price_increase', severity: 'warn',
    title: 'Netflix went from ₹499 to ₹649 a month',
    detail: 'The charge changed on 2026-08-12. The difference is ₹150 a month, which is ₹1,800 over 12 months.',
    annualImpact: 180_000, transactionIds: ids('netflix').slice(3),
    action: { label: 'Review plan', kind: 'review' },
  },
  {
    id: 'ins-quicknotes', kind: 'forgotten_subscription', severity: 'act',
    title: 'QuickNotes Pro has charged ₹129 every month for 6 months',
    detail: 'Small charge, same day each month, no other activity with this merchant. ₹129 x 12 = ₹1,548 a year.',
    annualImpact: 154_800, transactionIds: ids('forgotten'),
    action: { label: 'Cancel subscription', kind: 'cancel' },
  },
  {
    id: 'ins-late-fee', kind: 'late_fee', severity: 'act',
    title: 'You paid ₹1,180 as a late payment fee on 2026-09-28',
    detail: 'The ICICI card payment arrived after the due date. The fee is ₹1,000 plus 18% GST.',
    annualImpact: 118_000, transactionIds: ids('late'),
    action: { label: 'Ask the bank to reverse it', kind: 'call_bank' },
  },
  {
    id: 'ins-card-interest', kind: 'card_interest', severity: 'warn',
    title: 'You paid ₹842.50 in finance charges on 2026-09-29',
    detail: 'Finance charges apply when the full statement amount is not paid by the due date.',
    annualImpact: 84_250, transactionIds: ids('interest'),
    action: { label: 'Pay in full', kind: 'pay' },
  },
  {
    id: 'ins-annual-fee', kind: 'fee_paid', severity: 'info',
    title: 'You paid a ₹590 debit card annual fee on 2026-06-15',
    detail: 'Fee of ₹500 plus 18% GST charged by HDFC Bank.',
    annualImpact: 59_000, transactionIds: ids('fee'),
    action: { label: 'Ask for a waiver', kind: 'call_bank' },
  },
  {
    id: 'ins-swiggy-dupe', kind: 'duplicate_charge', severity: 'warn',
    title: 'Swiggy charged ₹499 twice on 2026-09-08',
    detail: 'Two identical ₹499 charges appear on the same day.',
    annualImpact: 49_900, transactionIds: ids('dupe'),
    action: { label: 'Dispute the second charge', kind: 'call_bank' },
  },
  {
    id: 'ins-forex', kind: 'forex_markup', severity: 'info',
    title: 'You paid ₹420 in forex markup on 2026-08-20',
    detail: 'A USD 142.00 purchase carried a 3.5% markup plus GST on the converted amount.',
    annualImpact: 42_000, transactionIds: ids('forex_base', 'forex'),
    action: { label: 'Review card terms', kind: 'review' },
  },
  {
    id: 'ins-card-due', kind: 'card_due_soon', severity: 'act',
    title: 'ICICI card: ₹42,000 is due on 2026-11-18',
    detail: 'Minimum due is ₹2,100. Paying only the minimum leaves ₹39,900 on which finance charges apply.',
    transactionIds: [], action: { label: 'Pay by due date', kind: 'pay' },
  },
  {
    id: 'ins-lumpy', kind: 'lumpy_expense_ahead', severity: 'warn',
    title: 'Rent, EMI and SIP total ₹81,391.16 on 5-7 November',
    detail: 'Three large debits fall within three days: ₹28,000 + ₹43,391.16 + ₹10,000.',
    transactionIds: [last('rent'), last('emi'), last('sip')],
  },
  {
    id: 'ins-prepay', kind: 'prepayment_opportunity', severity: 'info',
    title: 'The next home loan EMI includes ₹34,711.79 of interest',
    detail: 'Outstanding principal is ₹49,00,488.57 at 8.5% a year. Of the ₹43,391.16 EMI, ₹8,679.37 reduces the principal.',
    transactionIds: [last('emi')], action: { label: 'Try the prepayment calculator', kind: 'review' },
  },
];

const upcoming: UpcomingOutflow[] = [
  { date: '2026-11-05', label: 'Rent to Meera Nair', amount: 2_800_000, source: 'recurring' },
  { date: '2026-11-05', label: 'Home loan EMI, Sunrise Housing Finance', amount: 4_339_116, source: 'emi' },
  { date: '2026-11-07', label: 'Mutual fund SIP', amount: 1_000_000, source: 'recurring' },
  { date: '2026-11-12', label: 'Netflix', amount: 64_900, source: 'recurring' },
  { date: '2026-11-14', label: 'Hotstar', amount: 29_900, source: 'recurring' },
  { date: '2026-11-18', label: 'ICICI card payment due', amount: 4_200_000, source: 'card_due' },
  { date: '2026-11-20', label: 'QuickNotes Pro', amount: 12_900, source: 'recurring' },
  { date: '2026-12-05', label: 'Rent to Meera Nair', amount: 2_800_000, source: 'recurring' },
  { date: '2026-12-05', label: 'Home loan EMI, Sunrise Housing Finance', amount: 4_339_116, source: 'emi' },
  { date: '2026-12-07', label: 'Mutual fund SIP', amount: 1_000_000, source: 'recurring' },
  { date: '2026-12-12', label: 'Netflix', amount: 64_900, source: 'recurring' },
  { date: '2026-12-14', label: 'Hotstar', amount: 29_900, source: 'recurring' },
];

const cards: CardSummary[] = [{
  accountId: CARD, totalDue: 4_200_000, minimumDue: 210_000, dueDate: '2026-11-18',
  statementDate: '2026-10-29', creditLimit: 10_000_000, utilisationPct: 42,
}];

const LEAK_KINDS = new Set([
  'forgotten_subscription', 'duplicate_subscription', 'price_increase', 'fee_paid',
  'late_fee', 'card_interest', 'forex_markup', 'duplicate_charge',
]);

export const sampleReport: AuditReport = {
  asOf: '2026-11-03',
  accounts,
  transactions,
  recurring,
  loans,
  insights,
  headline: {
    annualLeak: insights.filter((i) => LEAK_KINDS.has(i.kind)).reduce((s, i) => s + (i.annualImpact ?? 0), 0),
    recurringAnnual: recurring.reduce((s, r) => s + r.annualCost, 0),
    emiMonthly: loans.reduce((s, l) => s + l.emi, 0),
  },
  flows: buildFlows(),
  upcoming,
  cards,
  safeToSpend: { untilDate: '2026-12-01', amount: 4_250_000 },
};
