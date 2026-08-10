import { useMemo, useState } from 'react';
import { Blueprint } from '../components/Blueprint';
import { useApp } from '../store/store';
import { fmt } from '../domain/format';
import { orderStatus, orderProgress, orderBook } from '../domain/orders';
import { pendingOrderValue } from '../domain/metrics';
import type { OrderStatus } from '../domain/types';
import { NewOrderDialog } from '../components/dialogs/NewOrderDialog';
import { OrderDetailDialog } from '../components/dialogs/OrderDetailDialog';

const STATUS_STYLE: Record<OrderStatus, { bg: string; fg: string }> = {
  open: { bg: '#eef6ff', fg: '#2c455d' },
  partial: { bg: '#f7e6c6', fg: '#875312' },
  fulfilled: { bg: '#dde9dd', fg: '#39633f' },
  cancelled: { bg: '#efefef', fg: '#9a9a9d' },
};

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 8, background: 'color-mix(in srgb,var(--color-text) 8%,transparent)', minWidth: 80, position: 'relative' }}>
      <div className="barfill" style={{ position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`, background: 'var(--color-accent)' }} />
    </div>
  );
}

export function Orders() {
  const { orders, effs, canEdit, period } = useApp();
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const book = useMemo(() => orderBook(orders), [orders]);
  const priceInfo = useMemo(() => {
    const byUid = new Map<string, number>();
    let hasPrice = false;
    for (const e of effs) { if (e.price > 0) { byUid.set(e.uid ?? e.id, e.price); hasPrice = true; } }
    return { hasPrice, value: pendingOrderValue(orders, byUid) };
  }, [effs, orders]);
  const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  const rows = useMemo(() => {
    const withStatus = orders.map((o) => ({ o, status: orderStatus(o), progress: orderProgress(o) }));
    return withStatus
      .filter((r) => statusFilter === 'all' || r.status === statusFilter)
      .sort((a, b) => b.o.no - a.o.no);
  }, [orders, statusFilter]);

  const kpi = (label: string, value: string, sub: string, color = 'var(--color-text)') => (
    <Blueprint className="card elev-sm" style={{ gap: 6 }}>
      <span className="card-kicker">{label}</span>
      <span className="kpi-value" style={{ color }}>{value}</span>
      <span className="card-meta" style={{ margin: 0 }}>{sub}</span>
    </Blueprint>
  );

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 34 }}>Orders</h1>
          <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
            Dealer orders and dispatch. Fulfilling a line dispatches stock into <strong>{period}</strong>.
          </p>
        </div>
        <button className="btn btn-primary no-print" onClick={() => setNewOpen(true)} disabled={!canEdit}>+ New order</button>
      </div>

      <div className="grid-kpi" style={{ marginBottom: 20 }}>
        {kpi('Open orders', fmt(book.openOrders), 'awaiting dispatch')}
        {kpi('Pending units', fmt(book.pendingUnits), `${fmt(book.pendingLines)} lines to ship`, 'var(--color-accent-700)')}
        {kpi('Fill rate', `${book.fillRate}%`, 'units dispatched ÷ ordered', book.fillRate >= 90 ? '#4e8055' : book.fillRate >= 60 ? '#b5852a' : '#a63a3a')}
        {priceInfo.hasPrice && kpi('Pending value', inr(priceInfo.value), 'undispatched order value', 'var(--color-accent-700)')}
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
        <div className="field" style={{ margin: 0, minWidth: 180 }}>
          <label>Status</label>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | OrderStatus)}>
            <option value="all">All orders</option>
            <option value="open">Open</option>
            <option value="partial">Partial</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <Blueprint className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="table" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>Order</th><th>Dealer</th><th>Date</th><th style={{ textAlign: 'right' }}>Lines</th>
              <th>Progress</th><th>Status</th><th className="no-print" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="text-muted" style={{ padding: 16 }}>No orders yet. Use <strong>+ New order</strong> to record one.</td></tr>
            ) : rows.map(({ o, status, progress }) => (
              <tr key={o.id}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{o.id}</td>
                <td style={{ fontWeight: 500 }}>{o.dealer || '—'}</td>
                <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{o.date}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.items.length}</td>
                <td style={{ minWidth: 130 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ProgressBar pct={progress.pct} />
                    <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmt(progress.fulfilled)}/{fmt(progress.ordered)}</span>
                  </div>
                </td>
                <td><span className="status-pill" style={{ background: STATUS_STYLE[status].bg, color: STATUS_STYLE[status].fg }}>{status}</span></td>
                <td className="no-print" style={{ textAlign: 'right' }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setDetailId(o.id)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Blueprint>

      {newOpen && <NewOrderDialog onClose={() => setNewOpen(false)} />}
      {detailId && <OrderDetailDialog orderId={detailId} onClose={() => setDetailId(null)} />}
    </section>
  );
}
