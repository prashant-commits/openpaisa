import type { IsoDate, Source, Transaction } from './types.js';

/** Lower is better: the row kept when the same transaction arrives from several sources. */
const SOURCE_RANK: Record<Source, number> = {
  statement_pdf: 0, statement_csv: 1, email: 2, sms: 3, notification: 4, manual: 5,
};

const CARD_BILL = /CREDIT\s*CARD|CC\s*PAYMENT|CARD\s*(?:PAYMENT|BILL)|BILLDESK|AUTOPAY|\bCRED\b|DREAMPLUG|CRED\.CLUB@/i;
const CARD_RECEIPT = /PAYMENT|THANK\s*YOU|RECEIVED/i;
const MOVE_CHANNEL = new Set(['upi', 'imps', 'neft', 'rtgs']);
const SELF_NARRATION = /\bSELF\b|OWN\s*ACCOUNT|TRANSFER\s*TO\s*SELF/i;
const NOT_A_PAYMENT = /REFUND|REVERSAL|CASHBACK/i;

const isCard = (t: Transaction): boolean => t.accountId.includes('-cc-');

function dayNumber(d: IsoDate): number {
  const [y, m, day] = d.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, day!) / 86_400_000);
}

interface Item { t: Transaction; i: number }

function sameCrossSource(a: Transaction, b: Transaction): boolean {
  if (a.source === b.source || a.amount !== b.amount || a.direction !== b.direction) return false;
  if (a.upiRef && a.upiRef === b.upiRef) return true;
  return Boolean(a.merchant) && a.merchant?.toLowerCase() === b.merchant?.toLowerCase() && Math.abs(dayNumber(a.date) - dayNumber(b.date)) <= 2;
}

/**
 * Remove the same transaction seen twice, and tag card-bill payments so they are not spend.
 * - identical id (same statement parsed twice, or overlapping periods): keep the best source
 * - same amount and direction with the same upiRef, or the same merchant within 2 days, from
 *   different sources: keep the best source (statement_pdf > statement_csv > email > sms > notification > manual)
 * - a savings-side card-bill debit and the card's payment credit of the same amount: keep both, mark card_payment
 * - a debit on one non-card account and a same-amount credit on a different non-card account within 2 days,
 *   both on upi/imps/neft/rtgs or with a SELF / OWN ACCOUNT narration: an own-account move, both marked transfers
 * Output is ordered by date, then by original order.
 */
export function dedupeTransactions(txns: Transaction[]): Transaction[] {
  // 1. Same id: one row, best source.
  const byId = new Map<string, Item>();
  txns.forEach((t, i) => {
    const prev = byId.get(t.id);
    if (!prev || SOURCE_RANK[t.source] < SOURCE_RANK[prev.t.source]) byId.set(t.id, { t, i: prev ? prev.i : i });
  });
  const unique = [...byId.values()];

  // 2. Same event from different sources.
  const kept: Item[] = [];
  const absorbed = new Map<number, Set<Source>>();
  const byRank = [...unique].sort((a, b) => SOURCE_RANK[a.t.source] - SOURCE_RANK[b.t.source] || a.i - b.i);
  for (const c of byRank) {
    const home = kept.find((k) => sameCrossSource(k.t, c.t) && !absorbed.get(k.i)?.has(c.t.source));
    if (home) {
      const set = absorbed.get(home.i) ?? new Set<Source>();
      set.add(c.t.source);
      absorbed.set(home.i, set);
    } else kept.push(c);
  }
  kept.sort((a, b) => a.i - b.i);

  // 3. Card-bill payments: savings debit + card credit.
  const rows = kept.map((k) => ({ ...k.t }));
  const used = new Set<number>();
  rows.forEach((credit, ci) => {
    if (!isCard(credit) || credit.direction !== 'credit' || !CARD_RECEIPT.test(credit.rawDescription) || NOT_A_PAYMENT.test(credit.rawDescription)) return;
    let best = -1;
    let bestGap = Infinity;
    rows.forEach((debit, di) => {
      if (used.has(di) || isCard(debit) || debit.direction !== 'debit' || debit.amount !== credit.amount || !CARD_BILL.test(debit.rawDescription)) return;
      const gap = dayNumber(credit.date) - dayNumber(debit.date);
      if (gap < -1 || gap > 5) return;
      if (Math.abs(gap) < bestGap) { best = di; bestGap = Math.abs(gap); }
    });
    if (best >= 0) {
      used.add(best);
      rows[best]!.category = 'card_payment';
      rows[ci]!.category = 'card_payment';
    }
  });

  // 4. Own-account moves: debit on one non-card account, credit on another.
  const movable = (t: Transaction): boolean =>
    !isCard(t) && t.category !== 'card_payment' && ((t.channel !== undefined && MOVE_CHANNEL.has(t.channel)) || SELF_NARRATION.test(t.rawDescription));
  const moved = new Set<number>();
  rows.forEach((debit, di) => {
    if (moved.has(di) || debit.direction !== 'debit' || !movable(debit)) return;
    let best = -1;
    let bestGap = Infinity;
    rows.forEach((credit, ci) => {
      if (moved.has(ci) || credit.direction !== 'credit' || credit.amount !== debit.amount || credit.accountId === debit.accountId || !movable(credit)) return;
      const gap = Math.abs(dayNumber(credit.date) - dayNumber(debit.date));
      if (gap <= 2 && gap < bestGap) { best = ci; bestGap = gap; }
    });
    if (best >= 0) {
      moved.add(di);
      moved.add(best);
      debit.category = 'transfers';
      rows[best]!.category = 'transfers';
    }
  });

  return rows
    .map((t, n) => ({ t, n }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.n - b.n))
    .map((x) => x.t);
}
