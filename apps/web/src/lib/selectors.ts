import type { Account, AuditReport, CardSummary, Category, IsoDate, Paise, Transaction } from '@openpaisa/engine';

/** Money moving between your own accounts or into investments is not spending. Mirrors NOT_SPEND in packages/engine/src/flows.ts. */
const NOT_SPEND: Category[] = ['transfers', 'card_payment', 'investments'];

function addMonthsKey(date: IsoDate): IsoDate {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${date.slice(8, 10)}`;
}

/** Sorted cycle starts, with the end (exclusive) of each. */
function cycleBounds(report: AuditReport): { start: IsoDate; end: IsoDate }[] {
  const starts = report.flows.map((f) => f.cycleStart).sort();
  return starts.map((start, i) => ({ start, end: starts[i + 1] ?? addMonthsKey(start) }));
}

function totalsFor(report: AuditReport, start: IsoDate, end: IsoDate): Map<Category, Paise> {
  const out = new Map<Category, Paise>();
  for (const t of report.transactions) {
    if (t.direction !== 'debit' || t.date < start || t.date >= end) continue;
    const cat = t.category ?? 'other';
    if (NOT_SPEND.includes(cat)) continue;
    out.set(cat, (out.get(cat) ?? 0) + t.amount);
  }
  return out;
}

/** Spend per category for one cycle, plus the average of up to 3 preceding cycles. Sorted by amount desc. */
export function spendByCategory(
  report: AuditReport, cycleStart: IsoDate,
): { category: Category; amount: Paise; avg3: Paise }[] {
  const bounds = cycleBounds(report);
  const idx = bounds.findIndex((b) => b.start === cycleStart);
  const cur = idx >= 0 ? bounds[idx]! : { start: cycleStart, end: addMonthsKey(cycleStart) };
  const prior = idx > 0 ? bounds.slice(Math.max(0, idx - 3), idx) : [];
  const current = totalsFor(report, cur.start, cur.end);
  const priorTotals = prior.map((b) => totalsFor(report, b.start, b.end));
  const cats = new Set<Category>(current.keys());
  return [...cats]
    .map((category) => {
      const sum = priorTotals.reduce((s, m) => s + (m.get(category) ?? 0), 0);
      return {
        category,
        amount: current.get(category) ?? 0,
        avg3: prior.length ? Math.round(sum / prior.length) : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

/** Case-insensitive search over merchant and raw description, newest first. `page` is 0-based. */
export function searchTransactions(
  report: AuditReport, q: string, page: number, pageSize = 50,
): { rows: Transaction[]; total: number } {
  const needle = q.trim().toLowerCase();
  const matches = report.transactions.filter(
    (t) => !needle || (t.merchant ?? '').toLowerCase().includes(needle) || t.rawDescription.toLowerCase().includes(needle),
  );
  matches.sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)));
  return { rows: matches.slice(page * pageSize, page * pageSize + pageSize), total: matches.length };
}

export function cardsSummary(report: AuditReport): (CardSummary & { account: Account })[] {
  const out: (CardSummary & { account: Account })[] = [];
  for (const c of report.cards) {
    const account = report.accounts.find((a) => a.id === c.accountId);
    if (account) out.push({ ...c, account });
  }
  return out;
}
