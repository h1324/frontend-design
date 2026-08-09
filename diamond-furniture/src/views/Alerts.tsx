import { useState } from 'react';
import { Blueprint } from '../components/Blueprint';
import { useApp } from '../store/store';
import { fmt } from '../domain/format';
import { STATUS_META } from '../domain/status';
import { resolveThreshold } from '../domain/logic';
import type { EffSku } from '../domain/types';

export function Alerts({ onEdit }: { onEdit: (s: EffSku) => void }) {
  const { effs, dataset, thresholds, canEdit, setDefaultThreshold, setLineThreshold } = useApp();
  const [lineForOverride, setLineForOverride] = useState('All lines (default)');

  const neg = effs.filter((s) => s.status === 'Negative').sort((a, b) => a.closing - b.closing);
  const low = effs.filter((s) => s.status === 'Low').sort((a, b) => a.cover - b.cover);
  const over = effs.filter((s) => s.status === 'Overstock').sort((a, b) => b.closing - a.closing);
  const noact = effs.filter((s) => s.status === 'No activity').sort((a, b) => b.closing - a.closing);

  const groups = [
    { title: 'Negative stock', desc: 'Recorded stock is below zero — a data/recording issue to correct first.', meta: STATUS_META.Negative, rows: neg, meta2: (s: EffSku) => `sold ${fmt(s.sold)}` },
    { title: 'Low / reorder', desc: 'At or below reorder point with active demand — order or produce now.', meta: STATUS_META.Low, rows: low, meta2: (s: EffSku) => `${s.cover.toFixed(1)} mo cover` },
    { title: 'Overstock', desc: `More than the line's overstock months of cover — cash sitting on the floor.`, meta: STATUS_META.Overstock, rows: over, meta2: (s: EffSku) => `${fmt(s.cover)} mo cover` },
    { title: 'No activity', desc: 'No sales and no stock on hand this month — dormant SKUs to review.', meta: STATUS_META['No activity'], rows: noact, meta2: () => 'no stock' },
  ];

  const isDefault = lineForOverride === 'All lines (default)';
  const eff = isDefault ? { lowMonths: thresholds.lowMonths, overMonths: thresholds.overMonths } : resolveThreshold(thresholds, lineForOverride);
  const perLineSet = !isDefault ? thresholds.byLine[lineForOverride] : undefined;

  const num = (v: string) => (v === '' ? undefined : Number(v));

  return (
    <section>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>Alerts</h1>
        <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
          Ranked by urgency. Default thresholds: reorder point + {thresholds.lowMonths}-month cover · overstock beyond {thresholds.overMonths} months.
          Set per-line overrides below.
        </p>
      </div>

      {canEdit && (
        <Blueprint className="card no-print" style={{ gap: 12, marginBottom: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0, minWidth: 210 }}>
              <label>Apply thresholds to</label>
              <select className="input" value={lineForOverride} onChange={(e) => setLineForOverride(e.target.value)}>
                {['All lines (default)', ...(dataset?.lines ?? [])].map((o) => (
                  <option key={o} value={o}>{o}{thresholds.byLine[o] ? '  •' : ''}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0, maxWidth: 210 }}>
              <label>Low-stock cover (months){!isDefault && perLineSet?.lowMonths == null ? ' — using default' : ''}</label>
              <input
                className="input" type="number" step={0.5} min={0} value={eff.lowMonths}
                onChange={(e) => (isDefault ? setDefaultThreshold('lowMonths', Number(e.target.value) || 0) : setLineThreshold(lineForOverride, 'lowMonths', num(e.target.value)))}
              />
            </div>
            <div className="field" style={{ margin: 0, maxWidth: 210 }}>
              <label>Overstock threshold (months){!isDefault && perLineSet?.overMonths == null ? ' — using default' : ''}</label>
              <input
                className="input" type="number" step={1} min={1} value={eff.overMonths}
                onChange={(e) => (isDefault ? setDefaultThreshold('overMonths', Number(e.target.value) || 1) : setLineThreshold(lineForOverride, 'overMonths', num(e.target.value)))}
              />
            </div>
            {!isDefault && (
              <button className="btn btn-ghost" onClick={() => { setLineThreshold(lineForOverride, 'lowMonths', undefined); setLineThreshold(lineForOverride, 'overMonths', undefined); }}>
                Reset {lineForOverride} to default
              </button>
            )}
          </div>
        </Blueprint>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18, alignItems: 'start' }}>
        {groups.map((g) => (
          <Blueprint key={g.title} className="card" style={{ gap: 12, borderTop: `3px solid ${g.meta.accent}` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <h4 style={{ margin: 0 }}>{g.title}</h4>
              <span className="tag" style={{ background: g.meta.bg, color: g.meta.accent }}>{g.rows.length}</span>
            </div>
            <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>{g.desc}</p>
            <div style={{ overflow: 'auto', maxHeight: 340 }}>
              {g.rows.length ? (
                <table className="table"><tbody>
                  {g.rows.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontSize: 12.5, lineHeight: 1.3 }}>
                        <strong>{s.model}</strong><br /><span className="text-muted">{s.line} · {s.colour || '—'}</span>
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: s.closing < 0 ? '#a63a3a' : 'var(--color-text)' }}>
                        {fmt(s.closing)}<br /><span className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>{g.meta2(s)}</span>
                      </td>
                      <td className="no-print" style={{ textAlign: 'right' }}>
                        <button className="btn btn-ghost" onClick={() => onEdit(s)} style={{ fontSize: 12 }}>{canEdit ? 'Edit' : 'View'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody></table>
              ) : (
                <p className="text-muted" style={{ fontSize: 13, padding: '6px 2px' }}>Nothing here — good.</p>
              )}
            </div>
          </Blueprint>
        ))}
      </div>
    </section>
  );
}
