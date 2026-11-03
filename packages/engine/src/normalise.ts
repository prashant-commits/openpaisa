import { matchMerchant } from './parsers/merchants.js';
import type { Channel, Direction, Transaction } from './types.js';

interface Hit {
  merchant?: string;
  channel?: Channel;
  upiRef?: string;
}

const SMALL_WORDS = new Set(['and', 'of', 'the']);
const TRAILING_PLACES = new Set([
  'IN', 'IND', 'INDIA', 'BANGALORE', 'BENGALURU', 'MUMBAI', 'DELHI', 'NEW', 'GURGAON', 'GURUGRAM', 'NOIDA', 'PUNE',
  'HYDERABAD', 'CHENNAI', 'KOLKATA', 'AHMEDABAD', 'JAIPUR', 'KOCHI', 'LUCKNOW', 'MH', 'KA', 'DL', 'TN', 'TS', 'HR', 'UP',
]);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Dictionary name when the payee is a known merchant, otherwise a Title Cased payee. */
function nameOf(payee: string): string | undefined {
  const p = payee.replace(/\s+/g, ' ').trim();
  if (!p) return undefined;
  return matchMerchant(p)?.name ?? titleCase(p);
}

const isRefToken = (t: string): boolean => /^[A-Z0-9]+$/i.test(t) && /\d/.test(t);
const SCHEME_TOKEN = /^(?:DR|CR|P2A|P2P|P2M|UPI\w*|IMPS|NEFT|RTGS)$/i;

function analyseUpi(d: string): Hit {
  const hit: Hit = { channel: 'upi' };
  const rrn = /(?<!\d)(\d{12})(?!\d)/.exec(d)?.[1];
  if (rrn) hit.upiRef = rrn;
  const tokens = d.split(/[/-]/).map((t) => t.trim()).filter(Boolean).slice(1);
  const payee = tokens.find((t) => !SCHEME_TOKEN.test(t) && !/^\d+$/.test(t) && !t.includes('@') && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(t) && !isRefToken(t));
  const name = payee ? nameOf(payee) : undefined;
  if (name) hit.merchant = name;
  return hit;
}

function analyseTransfer(d: string, channel: Channel): Hit {
  const tokens = d.split(/[/-]/).map((t) => t.trim()).filter(Boolean).slice(1);
  const payee = tokens.find((t) => !SCHEME_TOKEN.test(t) && !isRefToken(t));
  const name = payee ? nameOf(payee) : undefined;
  return name ? { channel, merchant: name } : { channel };
}

/** Guess a merchant from a card statement line: drop trailing city/country codes, keep up to three words. */
function cleanCardMerchant(d: string): string | undefined {
  const words = d.replace(/[^A-Za-z0-9&' ]/g, ' ').split(/\s+/).filter((w) => w && !/^\d+$/.test(w));
  while (words.length > 1 && TRAILING_PLACES.has(words[words.length - 1]!.toUpperCase())) words.pop();
  const name = words.slice(0, 3).join(' ');
  return name ? titleCase(name) : undefined;
}

/** Bank-fee phrasing. A bare FEE/CHARGES word is not enough: school, gym and membership fees are not bank fees. */
const BANK_FEE =
  /SMS CHARGE|LATE FEE|LATE PAYMENT|FINANCE CHARGE|MARKUP|CROSS CURRENCY|\b(?:IGST|CGST|SGST|GST)\b|MIN(?:IMUM)? BAL|NON MAINT|BOUNCE|RETURN CHG|ATM.*\b(?:FEE|CHG|CHARGES)\b|DEBIT CARD (?:ANNUAL FEE|AMC)|PENALTY/i;
/** Phrasing that is a bank fee only on a card account. */
const CARD_FEE = /ANNUAL FEE|JOINING FEE|RENEWAL FEE|\bAMC\s*(?:CHG|CHGS|CHARGES?|FEE)\b/i;

function analyseRaw(raw: string, direction: Direction, isCard: boolean): Hit {
  const d = raw.replace(/\s+/g, ' ').trim();

  if (/^UPI\b/i.test(d)) return analyseUpi(d);

  if (/^(?:NACH|ACH|ECS)\b/i.test(d)) {
    const rest = d.replace(/^(?:NACH|ACH|ECS)[\s/-]*(?:[DC]\s*-)?\s*/i, '');
    const name = matchMerchant(rest)?.name ?? analyseTransfer('X/' + rest, 'nach').merchant;
    return name ? { channel: 'nach', merchant: name } : { channel: 'nach' };
  }

  if (/^POS\b/i.test(d)) {
    const rest = d.replace(/^POS\s+/i, '').replace(/^\d{4}[X*]+\d{4}\s*/i, '');
    const name = matchMerchant(rest)?.name ?? cleanCardMerchant(rest);
    return name ? { channel: 'card', merchant: name } : { channel: 'card' };
  }

  const transfer = /^(NEFT|RTGS|IMPS)\b/i.exec(d);
  if (transfer) return analyseTransfer(d, transfer[1]!.toLowerCase() as Channel);

  if (/^(?:ATM|NFS|CASH WDL|CASH WITHDRAWAL)\b/i.test(d)) return { channel: 'atm', merchant: 'ATM' };
  if (/^(?:CHQ|CHEQUE|CLG|INW CLG)\b/i.test(d)) return { channel: 'cheque' };
  if (/INT\.?\s*PD|^INTEREST\b|^CREDIT INTEREST/i.test(d)) return { channel: 'interest', merchant: 'Interest' };
  const dict = matchMerchant(d);
  if (direction === 'debit' && (!dict || dict.name === 'Bank charges') && (BANK_FEE.test(d) || (isCard && CARD_FEE.test(d)))) {
    return { channel: 'fee', merchant: 'Bank charges' };
  }
  if (/CREDIT CARD|CC PAYMENT|CARD PAYMENT|PAYMENT RECEIVED|THANK YOU/i.test(d)) return { merchant: 'Card payment' };

  const hit: Hit = {};
  const m = matchMerchant(d);
  if (m && !(m.name === 'Bank charges' && direction === 'credit')) hit.merchant = m.name;
  if (/\bEMI\b/i.test(d)) hit.channel = 'emi';
  else if (isCard) hit.channel = 'card';
  if (!hit.merchant && isCard) {
    const guess = cleanCardMerchant(d);
    if (guess) hit.merchant = guess;
  }
  return hit;
}

/** CRED (and its operator Dreamplug) is how many people pay a card bill, so it is a card payment, not a merchant. */
const CRED_BILL = /\bCRED\b|\bCRED\s*CLUB\b|DREAMPLUG|CRED\.CLUB@/i;

function analyse(raw: string, direction: Direction, isCard: boolean): Hit {
  const hit = analyseRaw(raw, direction, isCard);
  if (CRED_BILL.test(raw)) hit.merchant = 'Card payment';
  return hit;
}

/**
 * Fill merchant, channel and UPI reference from the raw description. A merchant or
 * upiRef that is already set is kept, and so is the channel when no pattern matches.
 * Never changes id, amount, date or direction.
 */
export function normaliseTransactions(txns: Transaction[]): Transaction[] {
  return txns.map((t) => {
    const hit = analyse(t.rawDescription, t.direction, t.accountId.includes('-cc-'));
    const out: Transaction = { ...t };
    if (!out.merchant && hit.merchant) out.merchant = hit.merchant;
    if (!out.upiRef && hit.upiRef) out.upiRef = hit.upiRef;
    if (hit.channel) out.channel = hit.channel;
    return out;
  });
}
