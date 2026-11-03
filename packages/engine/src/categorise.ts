import { matchMerchant, merchantByName } from './parsers/merchants.js';
import type { Category, Transaction } from './types.js';

/** Categories where money coming back from the merchant is a refund, not income. */
const SPEND: ReadonlySet<Category> = new Set<Category>([
  'food_delivery', 'dining', 'groceries', 'shopping', 'travel', 'fuel', 'subscriptions',
  'entertainment', 'telecom', 'utilities', 'health', 'education',
]);

function fromDictionary(t: Transaction): Category | undefined {
  const entry = t.merchant ? (merchantByName(t.merchant) ?? matchMerchant(t.merchant)) : matchMerchant(t.rawDescription);
  if (!entry || entry.category === 'other') return undefined;
  return entry.category;
}

function fromKeywords(t: Transaction): Category {
  const text = `${t.rawDescription} ${t.merchant ?? ''}`.toUpperCase();
  const credit = t.direction === 'credit';
  if (credit && t.accountId.includes('-cc-') && /PAYMENT RECEIVED|THANK YOU|PAYMENT - /.test(text)) return 'card_payment';
  if (credit && /\bSALARY\b|\bSAL CR\b/.test(text)) return 'salary';
  if (credit && /REFUND|REVERSAL|REVERSED|CASHBACK/.test(text)) return 'refund';
  if (/INT\.?\s*PD|INTEREST/.test(text)) return credit ? 'interest' : 'fees_charges';
  if (/\b(?:CHARGES|FEES?|GST|IGST|CGST|SGST|PENALTY|MARKUP)\b/.test(text)) return 'fees_charges';
  if (/\bEMI\b|\bLOAN\b/.test(text)) return 'emi';
  if (/\bSIP\b|\bBSE\b|\bNSE\b|MUTUAL/.test(text)) return 'investments';
  if (/\bATM\b|CASH WDL|CASH WITHDRAWAL/.test(text)) return 'cash_withdrawal';
  if (!credit && /\bRENT\b/.test(text)) return 'rent';
  if (t.channel === 'upi' || t.channel === 'imps' || t.channel === 'neft' || t.channel === 'rtgs') return 'transfers';
  return 'other';
}

function decide(t: Transaction, overrides: Record<string, Category>): Category {
  const override = t.merchant ? overrides[t.merchant] : undefined;
  if (override) return override;
  if (t.category) return t.category;
  // A refund or reversal is money back, whatever the merchant.
  if (t.direction === 'credit' && /REFUND|REVERSAL|REVERSED|CASHBACK/i.test(t.rawDescription)) return 'refund';
  const known = fromDictionary(t);
  if (known) return t.direction === 'credit' && SPEND.has(known) ? 'refund' : known;
  return fromKeywords(t);
}

/**
 * Assign a category. Order: overrides (by merchant) -> an existing category (for example
 * card_payment from dedupe) -> the merchant dictionary -> keyword rules -> 'other'.
 */
export function categoriseTransactions(txns: Transaction[], overrides: Record<string, Category> = {}): Transaction[] {
  return txns.map((t) => ({ ...t, category: decide(t, overrides) }));
}
