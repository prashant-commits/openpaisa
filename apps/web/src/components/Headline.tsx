import type { AuditReport } from '@openpaisa/engine';
import { formatINR } from '@openpaisa/engine';

export function Headline({ report }: { report: AuditReport }) {
  const h = report.headline;
  return (
    <section className="card headline" aria-labelledby="hl">
      <h2 id="hl" className="sr">Audit headline</h2>
      <p className="big" style={{ margin: 0 }}>{formatINR(h.annualLeak, { decimals: false })} a year is leaking</p>
      <div className="stats">
        <div><b>{formatINR(h.recurringAnnual, { decimals: false })}</b><span className="muted">recurring payments a year</span></div>
        <div><b>{formatINR(h.emiMonthly)}</b><span className="muted">EMIs a month</span></div>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>As of {report.asOf}. Figures are arithmetic on your statements, not advice.</p>
    </section>
  );
}
