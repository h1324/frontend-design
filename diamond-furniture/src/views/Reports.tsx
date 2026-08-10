import { useState } from 'react';
import { Blueprint } from '../components/Blueprint';
import { useApp } from '../store/store';
import { useToast } from '../components/Toast';
import { fmt } from '../domain/format';
import { downloadCsv } from '../lib/csv';
import { kpis, lineSummaries } from '../domain/logic';
import { STATUS_META } from '../domain/status';

export function Reports() {
  const { effs, dataset, prodLog, period, isOwner, catalog, periods, financialYearLabel, scrubYear } = useApp();
  const flash = useToast();
  const [confirmScrub, setConfirmScrub] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const k = kpis(effs);
  const machinesFresh = dataset?.machines.reduce((a, m) => a + m.fresh, 0) ?? 0;
  const loggedTotal = prodLog.reduce((a, l) => a + l.qty, 0);
  const rows = [...lineSummaries(effs)].sort((a, b) => b.stock - a.stock);

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
