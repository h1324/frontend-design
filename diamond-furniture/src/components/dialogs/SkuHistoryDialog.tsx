import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Blueprint } from '../Blueprint';
import { useApp } from '../../store/store';
import { fmt } from '../../domain/format';
import { skuHistory } from '../../domain/logic';
import { lastSaleInfo } from '../../domain/metrics';
import type { EffSku } from '../../domain/types';

/** Shorten a month label for a tight axis: "April 2026" → "Apr '26". */
function shortLabel(label: string): string {
  const m = /^([A-Za-z]{3})[a-z]* \d{2}(\d{2})$/.exec(label);
  return m ? `${m[1]} '${m[2]}` : label;
}

/** Read-only drawer: one SKU's stock + sales month by month. */
export function SkuHistoryDialog({ sku, onClose }: { sku: EffSku; onClose: () => void }) {
  const { periods, currentPeriodKey } = useApp();
  const uid = sku.uid ?? sku.id;
  const hist = skuHistory(uid, periods);
  const last = lastSaleInfo(uid, periods, currentPeriodKey);
  const data = hist.map((h) => ({ name: shortLabel(h.label), Stock: h.closing, Sold: h.sold }));

  return (
    <div className="dialog-backdrop no-print" onClick={onClose}>
      <Blueprint className="dialog" style={{ width: 'min(620px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <span className="card-kicker">{sku.line}</span>
              <div className="dialog-title" style={{ marginTop: 2 }}>{sku.model} · {sku.colour || '—'}</div>
            </div>
            <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              {last.monthsSince == null ? 'never sold'
                : last.monthsSince === 0 ? 'sold this month'
                : `last sold ${last.lastLabel} (${last.monthsSince} mo ago)`}
            </span>
          </div>

          {data.length < 2 ? (
            <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              Only one month is on file, so there's no trend to plot yet. As you import more months,
              this SKU's stock and sales history will appear here as a chart.
            </p>
          ) : (
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-divider)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-accent)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-accent)' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Stock" stroke="var(--series-a)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Sold" stroke="var(--series-b)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ border: '1px solid var(--color-divider)', overflow: 'auto', maxHeight: 200 }}>
            <table className="table"><thead><tr>
              <th>Month</th><th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Stock end</th>
            </tr></thead><tbody>
              {[...hist].reverse().map((h) => (
                <tr key={h.key}>
                  <td style={{ fontSize: 12.5 }}>{h.label}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(h.sold)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: h.closing < 0 ? '#a63a3a' : 'var(--color-text)' }}>{fmt(h.closing)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>

          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </>
      </Blueprint>
    </div>
  );
}
