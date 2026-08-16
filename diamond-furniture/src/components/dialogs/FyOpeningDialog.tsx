import { useState, type ChangeEvent } from 'react';
import { Blueprint } from '../Blueprint';
import { useApp } from '../../store/store';
import { useToast } from '../Toast';
import { parseWorkbook } from '../../domain/parseWorkbook';
import { fmt } from '../../domain/format';
import type { ParsedWorkbook } from '../../domain/types';

const OK = '#4e8055';
const ERR = '#a63a3a';

/**
 * Set the financial-year opening-stock baseline from a dedicated file (the
 * Opening Stock column per SKU). This is the clean starting point everything
 * else builds on; it does NOT touch the monthly sold/closing numbers.
 */
export function FyOpeningDialog({ onClose }: { onClose: () => void }) {
  const { setFyOpening, financialYearLabel } = useApp();
  const flash = useToast();
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(true);
  const [fileName, setFileName] = useState('No file selected');
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [fyLabel, setFyLabel] = useState(financialYearLabel || '');

  const openingUnits = parsed ? parsed.skus.reduce((a, s) => a + s.opening, 0) : 0;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg(''); setFileName(file.name); setParsed(null);
    try {
      const res = await parseWorkbook(file);
      setBusy(false);
      if (!res.skus.length) {
        setOk(false);
        setMsg('No Master SKU List sheet found — this file needs the per-SKU Opening Stock column.');
        return;
      }
      setOk(true);
      setParsed(res);
      setMsg(`Read opening stock for ${res.skus.length} SKUs.`);
    } catch (err) {
      setBusy(false); setOk(false);
      setMsg('Could not read file: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const apply = async () => {
    if (!parsed || applying || !fyLabel.trim()) return;
    setApplying(true);
    try {
      await setFyOpening(parsed, fyLabel.trim());
      flash(`Financial-year opening stock set for FY ${fyLabel.trim()}`);
      onClose();
    } catch (err) {
      setApplying(false); setOk(false);
      setMsg('Could not save: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="dialog-backdrop no-print" onClick={onClose}>
      <Blueprint className="dialog" style={{ width: 'min(520px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <>
          <div className="dialog-title">Set financial-year opening stock</div>
          <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            Upload a file with each SKU's <strong>Opening Stock</strong> (a Master-style sheet works).
            This becomes the clean starting point for the year — production and sales build on top of it.
            It does <strong>not</strong> change any month's sold or closing numbers.
          </p>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px dashed var(--color-neutral-400)', padding: 20, textAlign: 'center', cursor: 'pointer', background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)' }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>{fileName}</span>
            <span className="text-muted" style={{ fontSize: 12 }}>Click to choose a .xlsx file</span>
            <input type="file" accept=".xlsx" onChange={onFile} style={{ display: 'none' }} />
          </label>

          {busy && <p style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-700)' }}>Reading…</p>}
          {msg && (
            <div style={{ border: `1px solid ${ok ? OK : ERR}`, background: `color-mix(in srgb, ${ok ? OK : ERR} 10%, transparent)`, padding: '11px 13px', fontSize: 13, color: ok ? OK : ERR }}>
              {msg}{parsed ? ` Opening total: ${fmt(openingUnits)} units.` : ''}
            </div>
          )}

          {parsed && (
            <div className="field" style={{ margin: 0 }}>
              <label>Financial year</label>
              <input className="input" value={fyLabel} onChange={(e) => setFyLabel(e.target.value)} placeholder="e.g. 2026-27" />
              <p className="text-muted" style={{ margin: '6px 0 0', fontSize: 12 }}>The Indian financial year (April–March) this opening stock belongs to.</p>
            </div>
          )}

          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={applying}>{parsed ? 'Cancel' : 'Close'}</button>
            <button className="btn btn-primary" onClick={apply} disabled={!parsed || applying || !fyLabel.trim()}>
              {applying ? 'Saving…' : 'Set opening stock'}
            </button>
          </div>
        </>
      </Blueprint>
    </div>
  );
}
