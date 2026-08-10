import { useMemo, useState } from 'react';
import { Blueprint } from '../Blueprint';
import { useApp } from '../../store/store';
import { useToast } from '../Toast';
import { fmt } from '../../domain/format';
import type { OrderItem } from '../../domain/types';

export function NewOrderDialog({ onClose }: { onClose: () => void }) {
  const { effs, createOrder } = useApp();
  const flash = useToast();
  const [dealer, setDealer] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [items, setItems] = useState<OrderItem[]>([]);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  const chosen = new Set(items.map((i) => i.uid));
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return effs
      .filter((s) => !chosen.has(s.id) && (s.line + ' ' + s.model + ' ' + s.colour).toLowerCase().includes(query))
      .slice(0, 8);
  }, [q, effs, chosen]);

  const add = (uid: string) => {
    const s = effs.find((e) => e.id === uid);
    if (!s) return;
    setItems((xs) => [...xs, { uid: s.id, line: s.line, model: s.model, colour: s.colour, qtyOrdered: 1, qtyFulfilled: 0 }]);
    setQ('');
  };
  const setQty = (uid: string, qty: number) => setItems((xs) => xs.map((i) => (i.uid === uid ? { ...i, qtyOrdered: Math.max(1, Math.round(qty) || 1) } : i)));
  const remove = (uid: string) => setItems((xs) => xs.filter((i) => i.uid !== uid));
  const totalUnits = items.reduce((a, i) => a + i.qtyOrdered, 0);

  const save = async () => {
    if (!dealer.trim() || items.length === 0 || saving) return;
    setSaving(true);
    try {
      await createOrder({ dealer: dealer.trim(), date, note: note.trim() || undefined, items });
      flash('Order created');
      onClose();
    } catch (e) {
      setSaving(false);
      flash('Could not create order: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="dialog-backdrop no-print" onClick={onClose}>
      <Blueprint className="dialog" style={{ width: 'min(560px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <>
          <div className="dialog-title">New order</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field" style={{ margin: 0 }}><label>Dealer / customer</label>
              <input className="input" value={dealer} onChange={(e) => setDealer(e.target.value)} placeholder="e.g. Sharma Furnitures" /></div>
            <div className="field" style={{ margin: 0 }}><label>Order date</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>

          <div className="field" style={{ margin: 0, position: 'relative' }}>
            <label>Add products</label>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search line / model / colour…" />
            {matches.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, background: 'var(--color-bg)', border: '1px solid var(--color-divider)', maxHeight: 220, overflow: 'auto' }}>
                {matches.map((s) => (
                  <button key={s.id} onClick={() => add(s.id)} style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8, textAlign: 'left', padding: '7px 10px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-divider)', cursor: 'pointer', fontSize: 12.5 }}>
                    <span><strong>{s.model}</strong> · {s.colour || '—'} <span className="text-muted">· {s.line}</span></span>
                    <span className="text-muted" style={{ whiteSpace: 'nowrap' }}>{fmt(s.closing)} in stock</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div style={{ border: '1px solid var(--color-divider)', maxHeight: 200, overflow: 'auto' }}>
              <table className="table"><tbody>
                {items.map((i) => (
                  <tr key={i.uid}>
                    <td style={{ fontSize: 12.5 }}><strong>{i.model}</strong> · {i.colour || '—'}<br /><span className="text-muted">{i.line}</span></td>
                    <td style={{ width: 90 }}>
                      <input className="input" type="number" min={1} value={i.qtyOrdered} onChange={(e) => setQty(i.uid, Number(e.target.value))} style={{ minHeight: 30, padding: '2px 6px' }} />
                    </td>
                    <td style={{ width: 40, textAlign: 'right' }}>
                      <button className="btn btn-ghost" style={{ fontSize: 14 }} title="Remove" onClick={() => remove(i.uid)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}

          <div className="field" style={{ margin: 0 }}><label>Note (optional)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. deliver by 15th, advance paid" /></div>

          <div className="dialog-actions" style={{ justifyContent: 'space-between' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>{items.length} lines · {fmt(totalUnits)} units</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || !dealer.trim() || items.length === 0}>
                {saving ? 'Saving…' : 'Create order'}
              </button>
            </div>
          </div>
        </>
      </Blueprint>
    </div>
  );
}
