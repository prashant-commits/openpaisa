import { useMemo, useState } from 'react';
import type { AuditReport } from '@openpaisa/engine';
import { formatINR } from '@openpaisa/engine';
import { searchTransactions, spendByCategory } from '../lib/selectors';
import { fmtCategory, fmtDate, fmtMonth } from '../lib/format';
import { BarChart } from './BarChart';

const PAGE = 50;

export function SpendsTab({ report }: { report: AuditReport }) {
  const cycles = report.flows.map((f) => f.cycleStart).sort();
  const [cycle, setCycle] = useState(cycles[cycles.length - 1] ?? report.asOf);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const rows = useMemo(() => spendByCategory(report, cycle).slice(0, 10), [report, cycle]);
  const result = useMemo(() => searchTransactions(report, q, page, PAGE), [report, q, page]);
  const pages = Math.max(1, Math.ceil(result.total / PAGE));
  const accountName = (id: string) => report.accounts.find((a) => a.id === id);

  return (
    <>
      <section className="card" aria-labelledby="sp-h">
        <h3 id="sp-h">Spending by category</h3>
        <label style={{ maxWidth: 240 }}>Salary cycle
          <select value={cycle} onChange={(e) => setCycle(e.target.value)}>
            {cycles.map((c) => <option key={c} value={c}>{fmtMonth(c)}</option>)}
          </select>
        </label>
        {rows.length === 0 ? <p className="muted">No spending in this cycle.</p> : (
          <>
            <BarChart
              ariaLabel={`Top categories for the cycle starting ${fmtDate(cycle)}`}
              rows={rows.map((r) => ({
                label: fmtCategory(r.category), value: r.amount, valueText: formatINR(r.amount),
                marker: r.avg3 || undefined, markerText: r.avg3 ? formatINR(r.avg3) : undefined,
              }))}
            />
            <p className="legend">Bar: this cycle. Tick: average of up to 3 earlier cycles.</p>
          </>
        )}
      </section>
      <section className="card" aria-labelledby="tx-h">
        <h3 id="tx-h">Transactions</h3>
        <label>Search merchant or description
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </label>
        <p className="muted" role="status">{result.total} transaction{result.total === 1 ? '' : 's'}</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {result.rows.map((t) => {
                const a = accountName(t.accountId);
                return (
                  <tr key={t.id}>
                    <td>{fmtDate(t.date)}</td>
                    <td>{t.merchant ?? t.rawDescription}</td>
                    <td>{t.category ? fmtCategory(t.category) : '-'}</td>
                    <td>{a ? `${a.institution} ${a.last4 ?? ''}` : t.accountId}</td>
                    <td className="num">{t.direction === 'credit' ? '+' : '-'}{formatINR(t.amount)}<span className="sr"> {t.direction}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {Math.min(page + 1, pages)} of {pages}</span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </section>
    </>
  );
}
