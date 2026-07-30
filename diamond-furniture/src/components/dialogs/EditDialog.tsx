import { useState } from 'react';
import type { EffSku } from '../../domain/types';
import { Blueprint } from '../Blueprint';
import { useApp } from '../../store/store';
import { useToast } from '../Toast';

export function EditDialog({ sku, onClose }: { sku: EffSku; onClose: () => void }) {
  const { canEdit, saveEdit } = useApp();
  const flash = useToast();
  const [stock, setStock] = useState(String(sku.closing));
  const [sold, setSold] = useState(String(sku.sold));
  const [reorder, setReorder] = useState(String(sku.reorder));
  const [note, setNote] = useState(sku.note);
  const [saleQty, setSaleQty] = useState('');

  const soldN = Number(sold) || 0;
  const stockN = Number(stock) || 0;
  const coverFmt = soldN > 0 ? (stockN / soldN).toFixed(1) + ' mo' : '—';

  const recordSale = () => {
    const qty = Number(saleQty) || 0;
    if (qty <= 0) return;
    setStock(String(Math.round(stockN - qty)));
    setSold(String(Math.round(soldN + qty)));
    setSaleQty('');
    flash(`Dispatch of ${qty} recorded — press Save to keep`);
  };

  const save = async () => {
    await saveEdit(
      sku.id,
      { closing: Math.round(stockN), sold: Math.round(soldN), reorder: Math.round(Number(reorder) || 0), note },
      sku.closing,
    );
    flash('Saved');
    onClose();
  };

  return (
    <div className="dialog-backdrop no-print" onClick={onClose}>
      <Blueprint className="dialog" style={{ width: 'min(460px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <>
          <div>
            <span className="card-kicker">{sku.line}</span>
            <div className="dialog-title" style={{ marginTop: 2 }}>{sku.model} · {sku.colour || '—'}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Stock on hand</label>
              <input className="input" type="number" value={stock} onChange={(e) => setStock(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Demand / month (sold)</label>
              <input className="input" type="number" value={sold} onChange={(e) => setSold(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Reorder point</label>
              <input className="input" type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Months of cover</label>
              <input className="input" value={coverFmt} disabled />
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Note</label>
            <textarea
              className="input" style={{ minHeight: 60 }} value={note}
              onChange={(e) => setNote(e.target.value)} disabled={!canEdit}
              placeholder="e.g. mould under repair, dealer backorder…"
            />
          </div>

          {canEdit && (
            <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 12, display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <div className="field" style={{ margin: 0, flex: 1 }}>
                <label>Record a dispatch (sale)</label>
                <input className="input" type="number" min={0} value={saleQty} onChange={(e) => setSaleQty(e.target.value)} placeholder="units shipped" />
              </div>
              <button className="btn btn-secondary" onClick={recordSale}>Ship</button>
            </div>
          )}

          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!canEdit}>Save changes</button>
          </div>
        </>
      </Blueprint>
    </div>
  );
}
