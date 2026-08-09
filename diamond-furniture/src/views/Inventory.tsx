import { useMemo, useState } from 'react';
import { Blueprint } from '../components/Blueprint';
import { StatusPill } from '../components/StatusPill';
import { useApp } from '../store/store';
import { fmt, coverLabel } from '../domain/format';
import { downloadCsv } from '../lib/csv';
import { ALL_STATUSES } from '../domain/status';
import type { EffSku, Status } from '../domain/types';

const PAGE = 40;
const IDLE_FILTER = 'Idle stock (no sales)';

export function Inventory({ onEdit }: { onEdit: (s: EffSku) => void }) {
  const { effs, dataset, canEdit, period } = useApp();
  const [q, setQ] = useState('');
  const [lineFilter, setLineFilter] = useState('All lines');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const rows = effs.filter((s) => {
      if (lineFilter !== 'All lines' && s.line !== lineFilter) return false;
      if (statusFilter === IDLE_FILTER) {
        if (!s.idle) return false;
      } else if (statusFilter !== 'All statuses' && s.status !== statusFilter) return false;
      if (query && !(s.line + ' ' + s.model + ' ' + s.colour).toLowerCase().includes(query)) return false;
      return true;
    });
    rows.sort((a, b) => a.line.localeCompare(b.line) || a.model.localeCompare(b.model) || a.colour.localeCompare(b.colour));
    return rows;
  }, [effs, q, lineFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const p = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(p * PAGE, p * PAGE + PAGE);

  const exportInv = () =>
    downloadCsv(
      `diamond_inventory_${period.replace(/\s+/g, '_').toLowerCase()}.csv`,
      ['Line', 'Model', 'Colour', 'Stock', 'Sold', 'MonthsCover', 'Reorder', 'Status', 'Note'],
      effs.map((s) => [s.line, s.model, s.colour, s.closing, s.sold, s.cover >= 999 ? '' : s.cover.toFixed(1), s.reorder, s.status, s.note]),
    );

  const setFilter = (fn: () => void) => { fn(); setPage(0); };

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 34 }}>Master SKU List</h1>
          <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 14 }}>{fmt(filtered.length)} of {fmt(effs.length)} SKUs shown</p>
        </div>
        <button className="btn btn-secondary no-print" onClick={exportInv}>Export CSV</button>
      </div>

      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
        <div className="field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
          <label>Search model / colour / line</label>
          <input className="input" value={q} onChange={(e) => setFilter(() => setQ(e.target.value))} placeholder="e.g. Big Chair, Brown, 2001…" />
        </div>
        <div className="field" style={{ margin: 0, minWidth: 170 }}>
          <label>Product line</label>
          <select className="input" value={lineFilter} onChange={(e) => setFilter(() => setLineFilter(e.target.value))}>
            {['All lines', ...(dataset?.lines ?? [])].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 160 }}>
          <label>Status</label>
          <select className="input" value={statusFilter} onChange={(e) => setFilter(() => setStatusFilter(e.target.value))}>
            {['All statuses', ...ALL_STATUSES, IDLE_FILTER].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <Blueprint className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="table" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th>Line</th><th>Model / Variant</th><th>Colour</th>
              <th style={{ textAlign: 'right' }}>Stock</th><th style={{ textAlign: 'right' }}>Demand/mo</th>
              <th style={{ textAlign: 'right' }}>Cover</th><th style={{ textAlign: 'right' }}>Reorder</th>
              <th>Status</th><th className="no-print" />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((s) => (
              <tr key={s.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12.5, color: 'var(--color-neutral-700)' }}>{s.line}</td>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{s.model}</td>
                <td><span className="tag tag-neutral">{s.colour || '—'}</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: s.closing < 0 ? '#a63a3a' : 'var(--color-text)' }}>{fmt(s.closing)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.sold)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-700)' }}>{coverLabel(s.cover, s.sold, s.closing)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-neutral-600)' }}>{fmt(s.reorder)}</td>
                <td><StatusPill status={s.status as Status} /></td>
                <td className="no-print" style={{ textAlign: 'right' }}>
                  <button className="btn btn-ghost" onClick={() => onEdit(s)} style={{ fontSize: 12 }}>{canEdit ? 'Edit' : 'View'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Blueprint>

      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 }}>
        <span className="text-muted" style={{ fontSize: 13 }}>Page {p + 1} of {pageCount}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setPage((x) => Math.max(0, x - 1))} disabled={p <= 0}>← Prev</button>
          <button className="btn btn-secondary" onClick={() => setPage((x) => x + 1)} disabled={p >= pageCount - 1}>Next →</button>
        </div>
      </div>
    </section>
  );
}
