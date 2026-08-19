import { useMemo, useState, type ChangeEvent } from 'react';
import { Blueprint } from '../Blueprint';
import { useApp } from '../../store/store';
import { useToast } from '../Toast';
import { parseWorkbook } from '../../domain/parseWorkbook';
import { mergeParsed, summarizeParse } from '../../domain/applyImport';
import { periodKeyFromLabel } from '../../domain/period';
import type { ParsedWorkbook } from '../../domain/types';

const OK = '#4e8055';
const ERR = '#a63a3a';

/** One file the user picked, with what we read out of it. */
interface FileEntry {
  name: string;
  ok: boolean;
  message: string;
  skus: number;
  machines: number;
  tabs?: number;         // product tabs consolidated (raw production file)
  skipped?: string[];    // tabs that couldn't be consolidated
  month: string | null;  // month detected from THIS file's name/sheets, or null
}

/**
 * The month a single file belongs to, read from its name or sheet names — the
 * production file usually carries it (e.g. "Production_update_APRIL_2026"),
 * while the master file does not (→ null). Only a real month name is accepted.
 */
function monthOf(names: string[], sheetNames: string[]): string | null {
  const hay = [...names, ...sheetNames].join('  ');
  const re = /([A-Za-z]+)[ _-]?(\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay))) {
    const month = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    const label = `${month} ${m[2]}`;
    if (periodKeyFromLabel(label)) return label;
  }
  return null;
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { applyImport, setFyOpening, period, periods, financialYearLabel } = useApp();
  const flash = useToast();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(true);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [merged, setMerged] = useState<ParsedWorkbook | null>(null);
  const [detectedPeriod, setDetectedPeriod] = useState(period);
  const [applying, setApplying] = useState(false);
  // What this file is: a month's numbers, or the financial-year opening baseline.
  const [kind, setKind] = useState<'month' | 'opening'>('month');
  const [fyLabel, setFyLabel] = useState(financialYearLabel || '');

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    setMsg('');
    setEntries([]);
    setMerged(null);

    const rows: FileEntry[] = [];
    const parts: ParsedWorkbook[] = [];
    for (const file of files) {
      try {
        const res = await parseWorkbook(file);
        const s = summarizeParse(res);
        rows.push({ name: file.name, ok: s.ok, message: s.message, skus: s.skuCount, machines: s.machineCount, tabs: res.consolidation?.tabs, skipped: res.consolidation?.skipped, month: monthOf([file.name], res.sheetNames) });
        if (s.ok) parts.push(res);
      } catch (err) {
        rows.push({ name: file.name, ok: false, message: err instanceof Error ? err.message : String(err), skus: 0, machines: 0, month: null });
      }
    }
    setBusy(false);
    setEntries(rows);

    if (!parts.length) {
      setOk(false);
      setMsg('None of the selected files had a Master SKU List or M-1…M-7 machine tabs. Check the sheet names match your usual layout.');
      return;
    }
    const combined = mergeParsed(parts);
    setMerged(combined);
    const summary = summarizeParse(combined);
    setOk(true);
    setMsg(summary.message);
    // One import = one month. Prefill the target from the (single) month the files
    // point to; if they disagree, the conflict guard below blocks Apply.
    const detected = [...new Set(rows.filter((r) => r.ok && r.month).map((r) => r.month as string))];
    setDetectedPeriod(detected.length === 1 ? detected[0] : period);
  };

  // Validate + describe the target month so the numbers always land where the
  // user expects (the detected name can be wrong, or absent on a Master file).
  const targetKey = periodKeyFromLabel(detectedPeriod);
  const existingLabels = useMemo(() => [...new Set(periods.map((p) => p.label))].sort(), [periods]);
  const overwrites = targetKey != null && periods.some((p) => p.key === targetKey);

  // Guard rail: one import writes one month. If the files name different months,
  // block Apply and show which is which so the user fixes the selection.
  const detectedMonths = useMemo(
    () => [...new Set(entries.filter((e) => e.ok && e.month).map((e) => e.month as string))],
    [entries],
  );
  const monthConflict = detectedMonths.length > 1;

  const canApply = merged != null && !applying
    && (kind === 'opening' ? fyLabel.trim().length > 0 : (!!targetKey && !monthConflict));

  const apply = async () => {
    if (!canApply || !merged) return;
    setApplying(true);
    try {
      if (kind === 'opening') {
        await setFyOpening(merged, fyLabel.trim());
        flash(`Opening stock set for FY ${fyLabel.trim()} (${merged.skus.length} SKUs)`);
      } else {
        await applyImport(merged, detectedPeriod);
        flash(`Imported ${merged.skus.length} SKUs into ${detectedPeriod} — data refreshed`);
      }
      onClose();
    } catch (err) {
      console.error('Import apply failed:', err);
      setApplying(false);
      setOk(false);
      const code = err && typeof err === 'object' && 'code' in err ? ` [${(err as { code: string }).code}]` : '';
      setMsg('Could not save to the cloud' + code + ': ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="dialog-backdrop no-print" onClick={onClose}>
      <Blueprint className="dialog" style={{ width: 'min(540px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <>
          <div className="dialog-title">Import production data (Excel)</div>
          <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            Upload a <strong>.xlsx production file</strong> — the app reads its product tabs and machine
            tabs (<strong>M-1…M-8</strong>) and builds every SKU's opening, sold and closing itself. One
            file per month is enough. After it reads, pick whether it's a <strong>month's data</strong> or
            your <strong>financial-year opening stock</strong>. Existing reorder points and notes are kept.
          </p>

          <label
            style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              border: '1px dashed var(--color-neutral-400)', padding: 22, textAlign: 'center',
              cursor: 'pointer', background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)',
            }}
          >
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>
              {entries.length ? `${entries.length} file${entries.length === 1 ? '' : 's'} selected` : 'No files selected'}
            </span>
            <span className="text-muted" style={{ fontSize: 12 }}>Click to choose one or more .xlsx files</span>
            <input type="file" accept=".xlsx" multiple onChange={onFiles} style={{ display: 'none' }} />
          </label>

          {entries.length > 0 && (
            <div style={{ border: '1px solid var(--color-divider)', overflow: 'auto', maxHeight: 150 }}>
              <table className="table"><tbody>
                {entries.map((f) => (
                  <tr key={f.name}>
                    <td style={{ fontSize: 12.5 }}>
                      <span style={{ color: f.ok ? OK : ERR, fontWeight: 600 }}>{f.ok ? '✓' : '✕'}</span>{' '}
                      {f.name}
                      {f.tabs != null && (
                        <span className="text-muted" style={{ fontSize: 11, display: 'block' }}>
                          consolidated {f.tabs} product tabs{f.skipped && f.skipped.length ? ` · skipped ${f.skipped.length} (${f.skipped.join(', ')})` : ''}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap', color: 'var(--color-neutral-600)' }}>
                      {f.ok
                        ? [f.skus ? `${f.skus} SKUs` : '', f.machines ? `${f.machines} machines` : ''].filter(Boolean).join(' · ')
                        : 'not recognised'}
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}

          {busy && <p style={{ margin: 0, fontSize: 13, color: 'var(--color-accent-700)' }}>Reading workbook{entries.length === 1 ? '' : 's'}…</p>}
          {msg && (
            <div style={{ border: `1px solid ${ok ? OK : ERR}`, background: `color-mix(in srgb, ${ok ? OK : ERR} 10%, transparent)`, padding: '11px 13px', fontSize: 13, lineHeight: 1.5, color: ok ? OK : ERR }}>
              {msg}
            </div>
          )}

          {merged && (
            <div className="field" style={{ margin: 0 }}>
              <label>What is this file?</label>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'month' | 'opening')}>
                <option value="month">A month's production / stock</option>
                <option value="opening">Financial-year opening stock (start of year)</option>
              </select>
            </div>
          )}

          {merged && kind === 'opening' && (
            <div className="field" style={{ margin: 0 }}>
              <label>Financial year</label>
              <input className="input" value={fyLabel} onChange={(e) => setFyLabel(e.target.value)} placeholder="e.g. 2026-27" />
              <p className="text-muted" style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.5 }}>
                Sets the clean opening-stock baseline for the year (April–March). It does <strong>not</strong>
                change any month's sold or closing numbers — no month needed.
              </p>
            </div>
          )}

          {merged && kind === 'month' && monthConflict && (
            <div style={{ border: `1px solid ${ERR}`, background: `color-mix(in srgb, ${ERR} 10%, transparent)`, padding: '11px 13px', fontSize: 13, lineHeight: 1.5, color: ERR }}>
              <strong>These files look like different months.</strong> An import saves one month at a time, so please import them separately:
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {entries.filter((e) => e.ok && e.month).map((e) => (
                  <li key={e.name}><strong>{e.month}</strong> — {e.name}</li>
                ))}
              </ul>
            </div>
          )}

          {merged && kind === 'month' && !monthConflict && (
            <div className="field" style={{ margin: 0 }}>
              <label>Import into month</label>
              <input
                className="input" list="import-months" value={detectedPeriod}
                onChange={(e) => setDetectedPeriod(e.target.value)}
                placeholder="e.g. April 2026"
              />
              <datalist id="import-months">
                {existingLabels.map((l) => <option key={l} value={l} />)}
              </datalist>
              <p className="text-muted" style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.5, color: targetKey ? undefined : ERR }}>
                {!targetKey
                  ? 'Type a month and year, e.g. “April 2026”, so the app knows which month these files belong to.'
                  : overwrites
                    ? `This replaces the stock & sold numbers already saved for ${detectedPeriod} (reorder points and notes are kept).`
                    : `This adds ${detectedPeriod} as a new month.`}
              </p>
            </div>
          )}

          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={applying}>{merged ? 'Cancel' : 'Close'}</button>
            <button className="btn btn-primary" onClick={apply} disabled={!canApply}>
              {applying ? 'Saving…' : kind === 'opening' ? 'Set opening stock' : 'Apply to app'}
            </button>
          </div>
        </>
      </Blueprint>
    </div>
  );
}
