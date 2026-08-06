import { useState, type ChangeEvent } from 'react';
import { Blueprint } from '../Blueprint';
import { useApp } from '../../store/store';
import { useToast } from '../Toast';
import { parseWorkbook } from '../../domain/parseWorkbook';
import { summarizeParse } from '../../domain/applyImport';
import type { ParsedWorkbook } from '../../domain/types';

const OK = '#4e8055';
const ERR = '#a63a3a';

/** Detect the period from the file name (e.g. "Production_update_APRIL_2026.xlsx"). */
function detectPeriod(fileName: string, sheetNames: string[], fallback: string): string {
  const hay = fileName + ' ' + sheetNames.join(' ');
  const m = /([A-Za-z]+)[ _]?(\d{4})/.exec(hay);
  if (m) {
    const month = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return `${month} ${m[2]}`;
  }
  return fallback;
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { applyImport, period } = useApp();
  const flash = useToast();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(true);
  const [fileName, setFileName] = useState('No file selected');
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [detectedPeriod, setDetectedPeriod] = useState(period);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg('');
    setFileName(file.name);
    setParsed(null);
    try {
      const res = await parseWorkbook(file);
      const summary = summarizeParse(res);
      setBusy(false);
      setOk(summary.ok);
      setMsg(summary.message);
      if (summary.ok) {
        setParsed(res);
        setDetectedPeriod(detectPeriod(file.name, res.sheetNames, period));
      }
    } catch (err) {
      setBusy(false);
      setOk(false);
      setMsg('Import failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const [applying, setApplying] = useState(false);

  const apply = async () => {
    if (!parsed || applying) return;
    setApplying(true);
    try {
      await applyImport(parsed, detectedPeriod);
      flash(`Imported ${parsed.skus.length} SKUs — data refreshed`);
      onClose();
    } catch (err) {
      setApplying(false);
      setOk(false);
      setMsg('Could not save to the cloud: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="dialog-backdrop no-print" onClick={onClose}>
      <Blueprint className="dialog" style={{ width: 'min(520px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <>
          <div className="dialog-title">Import production data (Excel)</div>
          <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            Upload your <strong>.xlsx</strong> workbook. The app reads a <strong>Master SKU List</strong>{' '}
            sheet (Line · Model · Colour · Opening · Sold · Closing) and any machine tabs{' '}
            (<strong>M-1…M-7</strong>) for fresh output. A file only replaces the parts it contains,
            so a production-only file updates machines without clearing your SKUs. Existing reorder
            points and notes are kept.
          </p>

          <label
            style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              border: '1px dashed var(--color-neutral-400)', padding: 22, textAlign: 'center',
              cursor: 'pointer', background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)',
            }}
          >
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>{fileName}</span>
            <span className="text-muted" style={{ fontSize: 12 }}>Click to choose a .xlsx file</span>
            <input type="file" accept=".xlsx" onChange={onFile} style={{ display: 'none' }} />
          </label>

          {busy && <p style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-700)' }}>Reading workbook…</p>}
          {msg && (
            <div style={{ border: `1px solid ${ok ? OK : ERR}`, background: `color-mix(in srgb, ${ok ? OK : ERR} 10%, transparent)`, padding: '11px 13px', fontSize: 13, lineHeight: 1.5, color: ok ? OK : ERR }}>
              {msg}
            </div>
          )}

          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={applying}>{parsed ? 'Cancel' : 'Close'}</button>
            <button className="btn btn-primary" onClick={apply} disabled={!parsed || applying}>
              {applying ? 'Saving…' : 'Apply to app'}
            </button>
          </div>
        </>
      </Blueprint>
    </div>
  );
}
