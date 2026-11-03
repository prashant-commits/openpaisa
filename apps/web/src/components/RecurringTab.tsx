import type { AuditReport } from '@openpaisa/engine';
import { formatINR } from '@openpaisa/engine';
import { fmtDate } from '../lib/format';

export function RecurringTab({ report }: { report: AuditReport }) {
  const rows = [...report.recurring].sort((a, b) => b.annualCost - a.annualCost);
  return (
    <section className="card" aria-labelledby="rc-h">
      <h3 id="rc-h">Recurring payments</h3>
      {rows.length === 0 ? <p className="muted">No recurring payments found.</p> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Payee</th><th>Every</th><th className="num">Each time</th><th className="num">Per year</th><th>Next</th><th>Notes</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.merchant}</td>
                  <td>{r.frequency.replace('_', ' ')}</td>
                  <td className="num">{formatINR(r.typicalAmount)}</td>
                  <td className="num">{formatINR(r.annualCost)}</td>
                  <td>{fmtDate(r.nextExpectedDate)}</td>
                  <td>
                    {r.possiblyForgotten && <span className="badge">Possibly forgotten</span>}
                    {r.priceChange && <div>Price changed from {formatINR(r.priceChange.from)} to {formatINR(r.priceChange.to)} on {fmtDate(r.priceChange.on)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={3}>Total per year</th><th className="num">{formatINR(rows.reduce((s, r) => s + r.annualCost, 0))}</th><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
