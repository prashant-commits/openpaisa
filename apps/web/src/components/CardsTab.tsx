import type { AuditReport } from '@openpaisa/engine';
import { formatINR } from '@openpaisa/engine';
import { cardsSummary } from '../lib/selectors';
import { fmtDate } from '../lib/format';

export function CardsTab({ report }: { report: AuditReport }) {
  const cards = cardsSummary(report);
  if (cards.length === 0) return <p className="card muted">No credit card statements found.</p>;
  return (
    <>
      {cards.map((c) => (
        <section key={c.accountId} className="card" aria-label={`${c.account.institution} card ${c.account.last4 ?? ''}`} style={{ display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0 }}>{c.account.institution} card {c.account.last4 ? `ending ${c.account.last4}` : ''}</h3>
          <dl className="kv">
            <div><dt>Total due</dt><dd>{formatINR(c.totalDue)}</dd></div>
            <div><dt>Minimum due</dt><dd>{formatINR(c.minimumDue)}</dd></div>
            <div><dt>Due date</dt><dd>{fmtDate(c.dueDate)}</dd></div>
            {c.creditLimit !== undefined && <div><dt>Credit limit</dt><dd>{formatINR(c.creditLimit)}</dd></div>}
          </dl>
          {c.utilisationPct !== undefined && (
            <div>
              <div id={`u-${c.accountId}`}>Utilisation: <b>{c.utilisationPct}%</b></div>
              <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, c.utilisationPct)} aria-labelledby={`u-${c.accountId}`}>
                <div style={{ width: `${Math.min(100, c.utilisationPct)}%` }} />
              </div>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
