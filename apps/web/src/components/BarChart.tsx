export interface BarRow { label: string; value: number; marker?: number; valueText: string; markerText?: string }

const W = 360, ROW = 44, LEFT = 0;

/** Horizontal bars, label and value above each bar. Marker is a vertical tick (e.g. 3-month average). */
export function BarChart({ rows, ariaLabel }: { rows: BarRow[]; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.marker ?? 0)));
  const scale = (v: number) => ((W - LEFT) * v) / max;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${rows.length * ROW}`} role="img" aria-label={ariaLabel}>
      {rows.map((r, i) => {
        const y = i * ROW;
        return (
          <g key={r.label}>
            <title>{`${r.label}: ${r.valueText}${r.markerText ? `; 3-month average ${r.markerText}` : ''}`}</title>
            <text x={LEFT} y={y + 14}>{r.label}</text>
            <text x={W} y={y + 14} textAnchor="end">{r.valueText}</text>
            <rect className="bar" x={LEFT} y={y + 20} width={Math.max(2, scale(r.value))} height={12} rx={3} />
            {r.marker ? <line className="mk" x1={scale(r.marker)} x2={scale(r.marker)} y1={y + 17} y2={y + 35} /> : null}
          </g>
        );
      })}
    </svg>
  );
}
