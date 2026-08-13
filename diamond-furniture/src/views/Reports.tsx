import { useState } from 'react';
import { Blueprint } from '../components/Blueprint';
import { useApp } from '../store/store';
import { useToast } from '../components/Toast';
import { fmt } from '../domain/format';
import { downloadCsv } from '../lib/csv';
import { kpis, lineSummaries } from '../domain/logic';
import { sellThrough, avgDaysCover, valuation, deadStock, productionPlan } from '../domain/metrics';
import { trailingPeriods } from '../domain/period';
import { STATUS_META } from '../domain/status';
import type { PeriodSnapshot } from '../domain/types';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function Reports() {
  const { effs, dataset, prodLog, period, isOwner, catalog, periods, currentPeriodKey, financialYearLabel, scrubYear } = useApp();
  const flash = useToast();
  const [confirmScrub, setConfirmScrub] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const k = kpis(effs);
  const machinesFresh = dataset?.machines.reduce((a, m) => a + m.fresh, 0) ?? 0;
  const loggedTotal = prodLog.reduce((a, l) => a + l.qty, 0);
  const rows = [...lineSummaries(effs)].sort((a, b) => b.stock - a.stock);

  // ── Phase C metrics ──────────────────────────────────────────────────────
  const st = sellThrough(effs);
  const daysCover = avgDaysCover(effs);
  const val = valuation(effs);
  const trailing = currentPeriodKey
    ? trailingPeriods(currentPeriodKey, 3).map((key) => periods.find((p) => p.key === key)).filter((p): p is PeriodSnapshot => !!p)
    : [];
  const dead = deadStock(effs, trailing);
  const deadUnits = dead.reduce((a, d) => a + d.closing, 0);
  const deadValue = dead.reduce((a, d) => a + d.closing * d.price, 0);

  // Production plan: what to make next month so each SKU still sits at its reorder
  // point after its expected (forecast) sales. Biggest need first.
  const plan = productionPlan(effs);
  const planUnits = plan.reduce((a, r) => a + r.make, 0);
  const planSlug = period.replace(/\s+/g, '_').toLowerCase();
  const exportPlan = () =>
    downloadCsv(`diamond_production_plan_${planSlug}.csv`,
      ['Line', 'Model', 'Colour', 'Current stock', 'Avg monthly demand', 'Reorder point', 'Suggested make'],
      plan.map((r) => [r.eff.line, r.eff.model, r.eff.colour, r.eff.closing, Math.round(r.eff.demand), r.eff.reorder, r.make]));

  const kpiCards = [
    { label: 'Units in stock', value: fmt(k.totalStock), sub: `across ${fmt(effs.length)} SKUs`, color: 'var(--color-text)' },
    { label: 'Sold this period', value: fmt(k.totalSold), sub: `${period} dispatches`, color: 'var(--color-text)' },
    { label: 'Urgent alerts', value: fmt(k.urgent), sub: `${k.negativeCount} negative · ${k.lowCount} low`, color: k.urgent ? STATUS_META.Negative.accent : 'var(--color-text)' },
    { label: 'Fresh produced', value: fmt(machinesFresh + loggedTotal), sub: `${dataset?.machines.length ?? 0} machines logged`, color: 'var(--color-accent-700)' },
  ];
  const slug = period.replace(/\s+/g, '_').toLowerCase();

  const exportInv = () =>
    downloadCsv(`diamond_inventory_${slug}.csv`,
      ['Line', 'Model', 'Colour', 'Stock', 'Sold', 'MonthsCover', 'Reorder', 'Status', 'Note'],
      effs.map((s) => [s.line, s.model, s.colour, s.closing, s.sold, s.cover >= 999 ? '' : s.cover.toFixed(1), s.reorder, s.status, s.note]));

  const exportAlerts = () => {
    const flagged = effs.filter((s) => s.status === 'Negative' || s.status === 'Low' || s.status === 'Overstock');
    downloadCsv(`diamond_alerts_${slug}.csv`,
      ['Type', 'Line', 'Model', 'Colour', 'Stock', 'Sold', 'MonthsCover'],
      flagged.map((s) => [s.status, s.line, s.model, s.colour, s.closing, s.sold, s.cover >= 999 ? '' : s.cover.toFixed(1)]));
  };

  return (
    <section>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>Reports</h1>
        <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 14 }}>Snapshot for {period}. Export a file, or print this page to PDF.</p>
      </div>

      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 22 }}>
        <button className="btn btn-primary" onClick={exportInv}>Export full inventory (CSV)</button>
        <button className="btn btn-secondary" onClick={exportAlerts}>Export alerts (CSV)</button>
        <button className="btn btn-secondary" onClick={exportPlan} disabled={plan.length === 0}>Export production plan (CSV)</button>
        <button className="btn btn-secondary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14, marginBottom: 22 }}>
        {kpiCards.map((c) => (
          <Blueprint key={c.label} className="card" style={{ gap: 6 }}>
            <span className="card-kicker">{c.label}</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 28, lineHeight: 1, color: c.color }}>{c.value}</span>
            <span className="card-meta" style={{ margin: 0 }}>{c.sub}</span>
          </Blueprint>
        ))}
      </div>

      {/* ── Insights (Phase C) ── */}
      <div className="grid-cards" style={{ marginBottom: 22 }}>
        <Blueprint className="card" style={{ gap: 10 }}>
          <h4 style={{ margin: 0 }}>Movement</h4>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div><div className="kpi-value" style={{ fontSize: 28 }}>{st}%</div><span className="card-meta" style={{ margin: 0 }}>sell-through (sold ÷ available)</span></div>
            <div><div className="kpi-value" style={{ fontSize: 28 }}>{daysCover ? fmt(daysCover) : '—'}</div><span className="card-meta" style={{ margin: 0 }}>avg days of stock cover</span></div>
          </div>
        </Blueprint>

        <Blueprint className="card" style={{ gap: 10 }}>
          <h4 style={{ margin: 0 }}>Stock value</h4>
          {val.hasPrice ? (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div><div className="kpi-value" style={{ fontSize: 26 }}>{inr(val.stockValue)}</div><span className="card-meta" style={{ margin: 0 }}>total stock on hand</span></div>
              <div><div className="kpi-value" style={{ fontSize: 26, color: STATUS_META.Overstock.accent }}>{inr(val.overstockValue)}</div><span className="card-meta" style={{ margin: 0 }}>tied up in overstock</span></div>
              <div><div className="kpi-value" style={{ fontSize: 26, color: '#4e7d78' }}>{inr(val.idleValue)}</div><span className="card-meta" style={{ margin: 0 }}>tied up in idle stock</span></div>
            </div>
          ) : (
            <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              Add a <strong>Price</strong> (or Rate / MRP) column to your Master import and ₹-values
              — stock value and cash tied up in overstock &amp; idle stock — appear here automatically.
            </p>
          )}
        </Blueprint>

        <Blueprint className="card" style={{ gap: 10, gridColumn: '1/-1' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0 }}>Dead stock <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>· no sales in the last {trailing.length} month{trailing.length === 1 ? '' : 's'}</span></h4>
            <span className="card-meta" style={{ margin: 0 }}>{fmt(dead.length)} SKUs · {fmt(deadUnits)} units{val.hasPrice ? ` · ${inr(deadValue)}` : ''}</span>
          </div>
          {trailing.length < 2 ? (
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>Import more months to detect true dead stock (this needs a few months of history).</p>
          ) : dead.length === 0 ? (
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>Nothing sitting completely unsold — good.</p>
          ) : (
            <div style={{ overflow: 'auto', maxHeight: 280 }}>
              <table className="table"><tbody>
                {dead.slice(0, 30).map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontSize: 12.5 }}><strong>{d.model}</strong> · {d.colour || '—'}<br /><span className="text-muted">{d.line}</span></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(d.closing)}<br /><span className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>in stock</span></td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}
        </Blueprint>

        <Blueprint className="card" style={{ gap: 10, gridColumn: '1/-1' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0 }}>Suggested production for next month <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>· to stay above the reorder point after forecast sales</span></h4>
            <span className="card-meta" style={{ margin: 0 }}>{fmt(plan.length)} SKUs · {fmt(planUnits)} units to make</span>
          </div>
          {plan.length === 0 ? (
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>Nothing is running low against its forecast — no production needed right now.</p>
          ) : (
            <div style={{ overflow: 'auto', maxHeight: 280 }}>
              <table className="table"><thead><tr>
                <th>Product</th><th style={{ textAlign: 'right' }}>Stock</th><th style={{ textAlign: 'right' }}>Demand/mo</th><th style={{ textAlign: 'right' }}>Make</th>
              </tr></thead><tbody>
                {plan.slice(0, 30).map((r) => (
                  <tr key={r.eff.id}>
                    <td style={{ fontSize: 12.5 }}><strong>{r.eff.model}</strong> · {r.eff.colour || '—'}<br /><span className="text-muted">{r.eff.line}</span></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.eff.closing < 0 ? '#a63a3a' : 'var(--color-text)' }}>{fmt(r.eff.closing)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(Math.round(r.eff.demand))}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--color-accent-700)' }}>{fmt(r.make)}</td>
                  </tr>
                ))}
              </tbody></table>
              {plan.length > 30 && <p className="text-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>Showing the top 30 — the full list is in the CSV export.</p>}
            </div>
          )}
        </Blueprint>
      </div>

      <Blueprint className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Product line</th><th style={{ textAlign: 'right' }}>Opening</th><th style={{ textAlign: 'right' }}>Sold</th>
              <th style={{ textAlign: 'right' }}>Stock now</th><th style={{ textAlign: 'right' }}># SKUs</th><th style={{ textAlign: 'right' }}>Flagged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.name}>
                <td style={{ fontWeight: 500 }}>{l.name}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.opening)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.sold)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(l.stock)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(l.count)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: l.flagged ? '#a63a3a' : 'var(--color-neutral-600)' }}>{fmt(l.flagged)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Blueprint>

      {isOwner && (
        <Blueprint className="card no-print" style={{ gap: 12, marginTop: 22, borderTop: '3px solid #a63a3a' }}>
          <h4 style={{ margin: 0 }}>Data management</h4>
          <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            Start a new financial year: this permanently clears all <strong>{periods.length} month(s)</strong> of
            production &amp; stock numbers, while <strong>keeping your SKU catalogue</strong> ({catalog.length} items —
            names, models, colours, reorder points and notes). Use it at the start of the Indian financial year, then
            import April's file. Owner-only, and recorded in the Activity log.
          </p>
          <div>
            <button className="btn btn-secondary" style={{ borderColor: '#a63a3a', color: '#a63a3a' }} onClick={() => setConfirmScrub(true)}>
              Start new financial year…
            </button>
          </div>
        </Blueprint>
      )}

      {confirmScrub && (
        <div className="dialog-backdrop no-print" onClick={() => !scrubbing && setConfirmScrub(false)}>
          <Blueprint className="dialog" onClick={(e) => e.stopPropagation()}>
            <>
              <div className="dialog-title">Start new financial year?</div>
              <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                This clears <strong>all {periods.length} month(s)</strong> of stock &amp; production numbers
                (current FY {financialYearLabel}). Your catalogue of <strong>{catalog.length} SKUs</strong> — names,
                models, colours, reorder points, notes — is kept, so you can import the new year's numbers onto it.
                This can't be undone from the app.
              </p>
              <div className="dialog-actions">
                <button className="btn btn-ghost" onClick={() => setConfirmScrub(false)} disabled={scrubbing}>Cancel</button>
                <button
                  className="btn btn-primary" style={{ background: '#a63a3a', borderColor: '#a63a3a' }} disabled={scrubbing}
                  onClick={async () => {
                    setScrubbing(true);
                    try { await scrubYear(); flash('New financial year started — numbers cleared, catalogue kept'); setConfirmScrub(false); }
                    catch (e) { flash('Could not clear: ' + (e instanceof Error ? e.message : String(e))); }
                    finally { setScrubbing(false); }
                  }}
                >
                  {scrubbing ? 'Clearing…' : 'Yes, clear the numbers'}
                </button>
              </div>
            </>
          </Blueprint>
        </div>
      )}
    </section>
  );
}
