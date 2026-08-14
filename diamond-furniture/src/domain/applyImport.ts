import type { Dataset, Machine, Overrides, Override, ParsedWorkbook, RawSku } from './types';

/**
 * Combine several parsed workbooks into one, for importing multiple files at
 * once (e.g. a Master SKU file + a Production file for the same month).
 *  - SKU rows are concatenated as-is. They are NOT deduped by natural key here:
 *    the real master legitimately holds rows that share line||model||colour, and
 *    normalizeDataset() disambiguates those downstream — collapsing them here
 *    would silently drop stock. In practice only one file carries the master
 *    list, so this is simply that file's rows.
 *  - Machines merge by name (later file wins), so each file can carry a
 *    different subset of the M-1…M-7 tabs without double-counting an overlap.
 *  - Lines and sheet names are unioned/concatenated.
 * Order of `parts` is the order the files were chosen.
 */
export function mergeParsed(parts: ParsedWorkbook[]): ParsedWorkbook {
  const skus: RawSku[] = [];
  const machineByName = new Map<string, Machine>();
  const lines = new Set<string>();
  const sheetNames: string[] = [];
  for (const p of parts) {
    skus.push(...p.skus);
    for (const m of p.machines) machineByName.set(m.name, m);
    for (const l of p.lines) lines.add(l);
    sheetNames.push(...p.sheetNames);
  }
  return {
    skus,
    lines: [...lines],
    machines: [...machineByName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    sheetNames,
  };
}

/**
 * Merge a parsed workbook into the current dataset (Bug 2 fix).
 *
 * A file only replaces the parts it actually contains:
 *  - product rows replace SKUs + lines ONLY when the file had a Master SKU sheet;
 *  - machine tabs replace machine output ONLY when the file had M-1…M-7 tabs.
 *
 * This lets a month arrive as one combined workbook OR two separate files
 * (master-only, or production-only) without a production-only upload wiping SKUs.
 */
export function applyParsedToDataset(current: Dataset, parsed: ParsedWorkbook): Dataset {
  const hasSkus = parsed.skus.length > 0;
  const hasMachines = parsed.machines.length > 0;
  return {
    skus: hasSkus ? parsed.skus : current.skus,
    lines: hasSkus ? parsed.lines : current.lines,
    machines: hasMachines ? parsed.machines : current.machines,
  };
}

/**
 * On import, imported stock/sold numbers win, but each SKU's manual reorder point
 * and note are preserved (per the agreed policy).
 */
export function preserveOverrides(ov: Overrides): Overrides {
  const kept: Overrides = {};
  for (const [id, o] of Object.entries(ov)) {
    const k: Override = {};
    if (o.reorder != null) k.reorder = o.reorder;
    if (o.note) k.note = o.note;
    if (Object.keys(k).length) kept[id] = k;
  }
  return kept;
}

export interface ImportSummary {
  ok: boolean;
  message: string;
  skuCount: number;
  lineCount: number;
  machineCount: number;
  freshTotal: number;
}

/** Human summary shown in the import dialog after parsing (before Apply). */
export function summarizeParse(parsed: ParsedWorkbook): ImportSummary {
  const skuCount = parsed.skus.length;
  const machineCount = parsed.machines.length;
  const freshTotal = parsed.machines.reduce((a, m) => a + m.fresh, 0);
  if (!skuCount && !machineCount) {
    return {
      ok: false,
      skuCount, lineCount: 0, machineCount, freshTotal,
      message:
        'Could not find a Master SKU List sheet or M-1…M-7 machine tabs in this workbook. ' +
        'Check the sheet names match your usual layout.',
    };
  }
  const parts: string[] = [];
  if (skuCount) parts.push(`${skuCount} SKUs across ${parsed.lines.length} lines`);
  if (machineCount) parts.push(`${machineCount} machine tabs (${freshTotal.toLocaleString('en-IN')} fresh pieces)`);
  return {
    ok: true,
    skuCount, lineCount: parsed.lines.length, machineCount, freshTotal,
    message: `Read ${parts.join(' · ')}. Press "Apply to app" to load it.`,
  };
}
