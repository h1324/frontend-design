import { useState } from 'react';
import { Blueprint } from '../Blueprint';
import { useApp } from '../../store/store';
import { useToast } from '../Toast';
import { fmt } from '../../domain/format';
import { orderStatus, orderProgress, itemPending } from '../../domain/orders';

export function OrderDetailDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { orders, canEdit, fulfilLine, cancelOrder, latestStock } = useApp();
  const flash = useToast();
  const order = orders.find((o) => o.id === orderId);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  if (!order) return null;
  const status = orderStatus(order);
  const progress = orderProgress(order);
  const active = canEdit && !order.cancelled && status !== 'fulfilled';

  const dispatch = async (index: number, amount: number) => {
    if (busy || amount <= 0) return;
    // Informational check: dispatching more than the latest sheet shows in stock.
    // Orders don't change the imported numbers, but this flags a likely mismatch.
    const uid = order.items[index]?.uid;
    const onHand = uid ? latestStock.get(uid) ?? 0 : 0;
    if (amount > onHand) {
      const ok = window.confirm(
        `The latest sheet shows only ${fmt(onHand)} in stock for this item, but you're dispatching ${fmt(amount)}.\n`
        + `Dispatching won't change the sheet numbers — but the gap may mean the stock figure is out of date. Continue?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await fulfilLine(order.id, index, amount);
      setQty((m) => ({ ...m, [index]: '' }));
      flash(`Dispatched ${amount}`);
    } catch (e) {
      flash('Could not dispatch: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  const fulfilAll = async () => {
    for (let i = 0; i < order.items.length; i++) {
      const pend = itemPending(order.items[i]);
      if (pend > 0) await dispatch(i, pend);
    }
  };

  return (
    <div className="dialog-backdrop no-print" onClick={onClose}>
      <Blueprint className="dialog" style={{ width: 'min(600px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <span className="card-kicker">{order.id} · {order.date}</span>
              <div className="dialog-title" style={{ marginTop: 2 }}>{order.dealer}</div>
            </div>
            <span className="status-pill" style={{ background: '#eef6ff', color: '#2c455d' }}>{status} · {progress.pct}%</span>
          </div>
          {order.note && <p className="text-muted" style={{ margin: 0, fontSize: 12.5 }}>{order.note}</p>}
          {active && <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>Fulfilling records dispatch against this order. It does <strong>not</strong> change the imported stock or sold figures — those stay as your source of truth.</p>}

          <div style={{ border: '1px solid var(--color-divider)', overflow: 'auto', maxHeight: 320 }}>
            <table className="table"><thead><tr>
              <th>Product</th><th style={{ textAlign: 'right' }}>Ordered</th><th style={{ textAlign: 'right' }}>Done</th><th style={{ textAlign: 'right' }}>Pending</th><th className="no-print" />
            </tr></thead><tbody>
              {order.items.map((it, i) => {
                const pend = itemPending(it);
                return (
                  <tr key={i}>
                    <td style={{ fontSize: 12.5 }}><strong>{it.model}</strong> · {it.colour || '—'}<br /><span className="text-muted">{it.line}</span></td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(it.qtyOrdered)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(it.qtyFulfilled)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: pend > 0 ? '#b5852a' : '#4e8055' }}>{pend > 0 ? fmt(pend) : '✓'}</td>
                    <td className="no-print" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {active && pend > 0 && (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <input className="input" type="number" min={1} max={pend} value={qty[i] ?? ''} placeholder={String(pend)}
                            onChange={(e) => setQty((m) => ({ ...m, [i]: e.target.value }))}
                            style={{ width: 66, minHeight: 30, padding: '2px 6px' }} />
                          <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy}
                            onClick={() => dispatch(i, Math.min(pend, Number(qty[i]) || pend))}>Ship</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>

          <div className="dialog-actions" style={{ justifyContent: 'space-between' }}>
            <div>
              {active && (
                <button className="btn btn-ghost" style={{ color: '#a63a3a' }} disabled={busy}
                  onClick={async () => { await cancelOrder(order.id); flash('Order cancelled'); }}>Cancel order</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
              {active && progress.pending > 0 && (
                <button className="btn btn-primary" onClick={fulfilAll} disabled={busy}>
                  {busy ? 'Dispatching…' : `Fulfil all (${fmt(progress.pending)})`}
                </button>
              )}
            </div>
          </div>
        </>
      </Blueprint>
    </div>
  );
}
