import { fmt } from '../domain/format';

export interface BarDatum {
  name: string;
  value: number;
}

/** Horizontal labelled bar list (top-N), matching the prototype's CSS bars. */
export function BarList({
  data, max, fill = 'var(--color-accent)', labelWidth = 120,
}: {
  data: BarDatum[];
  max: number;
  fill?: string;
  labelWidth?: number;
}) {
  const m = Math.max(1, max);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {data.map((d, i) => (
        <div key={i} className="barrow" style={{ gridTemplateColumns: `${labelWidth}px 1fr 74px` }}>
          <span className="label" title={d.name}>{d.name}</span>
          <div className="track">
            <div className="fill barfill" style={{ width: `${Math.round((d.value / m) * 100)}%`, background: fill }} />
          </div>
          <span className="value">{fmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
