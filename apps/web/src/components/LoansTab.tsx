import { useState } from 'react';
import type { AmortisationRow, AuditReport, Loan, PrepaymentResult } from '@openpaisa/engine';
import { formatINR, toPaise } from '@openpaisa/engine';
import { amortiseFn, prepayFn } from '../lib/engineApi';

const LATER = 'Available when the engine ships';

function yearlyRollup(rows: AmortisationRow[]) {
  const by = new Map<string, { interest: number; principal: number; emi: number; outstanding: number; n: number }>();
  for (const r of rows) {
    const y = r.date.slice(0, 4);
    const e = by.get(y) ?? { interest: 0, principal: 0, emi: 0, outstanding: 0, n: 0 };
    e.interest += r.interest; e.principal += r.principal; e.emi += r.emi; e.outstanding = r.outstanding; e.n += 1;
    by.set(y, e);
  }
  return [...by.entries()];
}

function Amortisation({ loan, asOf }: { loan: Loan; asOf: string }) {
  if (!amortiseFn) return <p className="muted">Amortisation table: {LATER}.</p>;
  let rows: AmortisationRow[] = [];
  try { rows = amortiseFn(loan, asOf); } catch { return <p className="muted">Not enough loan details to build an amortisation table.</p>; }
  if (rows.length === 0) return <p className="muted">Not enough loan details to build an amortisation table.</p>;
  return (
    <details>
      <summary>Amortisation by year</summary>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Year</th><th className="num">EMIs</th><th className="num">Interest</th><th className="num">Principal</th><th className="num">Outstanding at year end</th></tr></thead>
          <tbody>
            {yearlyRollup(rows).map(([y, e]) => (
              <tr key={y}><td>{y}</td><td className="num">{e.n}</td><td className="num">{formatINR(e.interest)}</td><td className="num">{formatINR(e.principal)}</td><td className="num">{formatINR(e.outstanding)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Prepay({ loan, asOf }: { loan: Loan; asOf: string }) {
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PrepaymentResult['mode']>('reduce_tenure');
  const fn = prepayFn;
  const idp = `pp-${loan.id}`;
  let out: string | null = null;
  let problem: string | null = null;
  if (fn && amount.trim() !== '') {
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || toPaise(amount.trim()) <= 0) problem = 'Enter an amount in rupees, like 100000.';
    else {
      try {
        const r = fn(loan, toPaise(amount.trim()), mode, asOf);
        out = mode === 'reduce_tenure'
          ? `Saves ${formatINR(r.interestSaved)} interest and ${r.monthsSaved} month${r.monthsSaved === 1 ? '' : 's'}`
          : `New EMI ${formatINR(r.newEmi)}; saves ${formatINR(r.interestSaved)} interest`;
      } catch { problem = 'Not enough loan details to run this calculation.'; }
    }
  }
  return (
    <fieldset>
      <legend>Prepayment calculator</legend>
      {!fn ? <p className="muted">{LATER}.</p> : (
        <div style={{ display: 'grid', gap: 12 }}>
          <label>Prepayment amount (₹)
            <input id={idp} type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <div role="radiogroup" aria-label="What the prepayment reduces" className="row">
            <label className="row" style={{ fontWeight: 400 }}><input type="radio" name={`m-${loan.id}`} checked={mode === 'reduce_tenure'} onChange={() => setMode('reduce_tenure')} /> Reduce tenure</label>
            <label className="row" style={{ fontWeight: 400 }}><input type="radio" name={`m-${loan.id}`} checked={mode === 'reduce_emi'} onChange={() => setMode('reduce_emi')} /> Reduce EMI</label>
          </div>
          {problem && <p role="alert" style={{ margin: 0, color: 'var(--act)' }}>{problem}</p>}
          {out && <p role="status" style={{ margin: 0, fontWeight: 700 }}>{out}</p>}
        </div>
      )}
    </fieldset>
  );
}

export function LoansTab({ report }: { report: AuditReport }) {
  if (report.loans.length === 0) return <p className="card muted">No loans or EMIs found.</p>;
  return (
    <>
      {report.loans.map((l) => (
        <section key={l.id} className="card" aria-label={`${l.lender} ${l.kind} loan`} style={{ display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0 }}>{l.lender} ({l.kind.replace('_', ' ')})</h3>
          <dl className="kv">
            <div><dt>EMI</dt><dd>{formatINR(l.emi)}</dd></div>
            {l.outstanding !== undefined && <div><dt>Outstanding</dt><dd>{formatINR(l.outstanding)}</dd></div>}
            {l.annualRatePct !== undefined && <div><dt>Rate</dt><dd>{l.annualRatePct}% a year</dd></div>}
            {l.tenureMonths !== undefined && <div><dt>Tenure</dt><dd>{l.tenureMonths} months</dd></div>}
          </dl>
          <Amortisation loan={l} asOf={report.asOf} />
          <Prepay loan={l} asOf={report.asOf} />
        </section>
      ))}
    </>
  );
}
