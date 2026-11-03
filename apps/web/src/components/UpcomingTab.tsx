import type { AuditReport } from '@openpaisa/engine';
import { formatINR } from '@openpaisa/engine';
import { fmtDate } from '../lib/format';

const SRC = { recurring: 'Recurring', card_due: 'Card due', emi: 'EMI' } as const;

function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function UpcomingTab({ report }: { report: AuditReport }) {
  const end = plusDays(report.asOf, 45);
  const items = report.upcoming.filter((u) => u.date >= report.asOf && u.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  const total = items.reduce((s, u) => s + u.amount, 0);
  return (
    <>
      {report.safeToSpend && (
        <section className="card" aria-labelledby="sts-h">
          <h3 id="sts-h">Safe to spend</h3>
          <p style={{ margin: 0 }}><b style={{ fontSize: '1.4rem' }}>{formatINR(report.safeToSpend.amount)}</b> until {fmtDate(report.safeToSpend.untilDate)}</p>
          <p className="muted" style={{ marginBottom: 0 }}>Balance minus the payments listed below that fall before that date.</p>
        </section>
      )}
      <section className="card" aria-labelledby="up-h2">
        <h3 id="up-h2">Next 45 days</h3>
        {items.length === 0 ? <p className="muted">Nothing expected.</p> : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Date</th><th>What</th><th>Type</th><th className="num">Amount</th></tr></thead>
              <tbody>{items.map((u, i) => <tr key={`${u.date}-${i}`}><td>{fmtDate(u.date)}</td><td>{u.label}</td><td>{SRC[u.source]}</td><td className="num">{formatINR(u.amount)}</td></tr>)}</tbody>
              <tfoot><tr><th colSpan={3}>Total</th><th className="num">{formatINR(total)}</th></tr></tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
