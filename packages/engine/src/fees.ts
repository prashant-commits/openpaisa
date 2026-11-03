import { compareIso, diffDays } from './dates.js';
import { formatINR } from './money.js';
import type { Insight, InsightKind, IsoDate, Transaction } from './types.js';

type FeeKind = Extract<InsightKind, 'late_fee' | 'card_interest' | 'forex_markup' | 'fee_paid'>;

/** Checked in this order; the first match wins. */
const PATTERNS: { kind: FeeKind; re: RegExp; cardOnly?: boolean }[] = [
  { kind: 'late_fee', re: /LATE PAYMENT|LATE FEE/i },
  { kind: 'card_interest', re: /FINANCE CHARGE|INTEREST CHARGED/i, cardOnly: true },
  { kind: 'forex_markup', re: /MARKUP|CROSS CURRENCY|FOREX|\bDCC\b/i },
  { kind: 'fee_paid', re: /ANNUAL FEE|JOINING FEE|\bAMC\b|SMS CHARGE|BOUNCE|RETURN CHG|MIN BAL|NON MAINT|ATM.*(FEE|CHG)/i },
];
const GST = /\b(GST|IGST|CGST|SGST)\b/i;

const COPY: Record<FeeKind, { noun: string; severity: Insight['severity']; action?: Insight['action'] }> = {
  late_fee: { noun: 'late fees', severity: 'act', action: { label: 'Ask bank about a waiver', kind: 'call_bank' } },
  card_interest: { noun: 'card interest charges', severity: 'act' },
  forex_markup: { noun: 'forex markup', severity: 'warn' },
  fee_paid: { noun: 'bank and card fees', severity: 'warn', action: { label: 'Ask bank about these charges', kind: 'call_bank' } },
};

const ORDER: FeeKind[] = ['late_fee', 'card_interest', 'forex_markup', 'fee_paid'];

/**
 * One insight per fee kind found. `cardAccountIds`, when given, restricts card
 * interest to those accounts (the transaction itself does not carry account kind).
 */
export function detectFees(txns: Transaction[], asOf: IsoDate, cardAccountIds?: ReadonlySet<string>): Insight[] {
  const debits = txns.filter((t) => t.direction === 'debit');
  const text = (t: Transaction) => `${t.rawDescription} ${t.merchant ?? ''}`;

  const byKind = new Map<FeeKind, Transaction[]>();
  const feeOnDay = new Map<string, FeeKind>(); // accountId|date -> first fee kind that day
  for (const t of debits) {
    const hit = PATTERNS.find((p) => p.re.test(text(t)) && (!p.cardOnly || !cardAccountIds || cardAccountIds.has(t.accountId)));
    if (!hit) continue;
    byKind.set(hit.kind, [...(byKind.get(hit.kind) ?? []), t]);
    const k = `${t.accountId}|${t.date}`;
    const prior = feeOnDay.get(k);
    if (!prior || ORDER.indexOf(hit.kind) < ORDER.indexOf(prior)) feeOnDay.set(k, hit.kind);
  }

  const claimed = new Set([...byKind.values()].flat().map((t) => t.id));
  for (const t of debits) {
    if (claimed.has(t.id) || !GST.test(text(t))) continue;
    const kind = feeOnDay.get(`${t.accountId}|${t.date}`);
    if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), t]);
  }

  const first = txns.reduce<IsoDate | undefined>((m, t) => (m === undefined || compareIso(t.date, m) < 0 ? t.date : m), undefined);
  const days = Math.max(first ? diffDays(first, asOf) : 0, 30);

  const out: Insight[] = [];
  for (const kind of ORDER) {
    const rows = byKind.get(kind);
    if (!rows?.length) continue;
    const total = rows.reduce((s, t) => s + t.amount, 0);
    const annual = Math.round((total * 365) / days);
    const copy = COPY[kind];
    out.push({
      id: `fee-${kind}`,
      kind,
      severity: copy.severity,
      title: `You paid ${formatINR(total)} in ${copy.noun}`,
      detail: `${rows.length} charge${rows.length === 1 ? '' : 's'} totalling ${formatINR(total)} (including any GST) over the ${days} days to ${asOf}. Over a year at the same rate that is ${formatINR(annual)}.`,
      annualImpact: annual,
      transactionIds: rows.map((t) => t.id),
      ...(copy.action ? { action: copy.action } : {}),
    });
  }
  return out;
}
