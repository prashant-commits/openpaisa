import type { Insight } from '@openpaisa/engine';
import { formatINR } from '@openpaisa/engine';

const LABEL = { act: 'Act now', warn: 'Worth a look', info: 'For information' } as const;

export function InsightCard({ insight }: { insight: Insight }) {
  return (
    <li className={`card insight ${insight.severity}`}>
      <span className={`sev ${insight.severity}`}>{LABEL[insight.severity]}</span>
      <h3>{insight.title}</h3>
      <p style={{ margin: '0 0 8px' }}>{insight.detail}</p>
      <div className="row muted">
        {insight.annualImpact ? <span>Yearly impact: <b>{formatINR(insight.annualImpact)}</b></span> : null}
        {insight.action ? <span>Next step: <b>{insight.action.label}</b></span> : null}
      </div>
    </li>
  );
}
