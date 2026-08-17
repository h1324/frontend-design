import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWorkbook } from '../parseWorkbook';
import { applyParsedToDataset, mergeParsed, preserveOverrides, summarizeParse } from '../applyImport';
import { skuId, eff, normalizeDataset, statusCounts, kpis } from '../logic';
import { DEFAULT_THRESHOLDS } from '../../store/types';
import type { Dataset, ParsedWorkbook } from '../types';
import dataJson from '../../data/data.json';

function fixture(name: string): Blob {
  const buf = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return new Blob([buf]);
}
const MASTER = 'Master_Inventory_Dashboard.xlsx';
const PRODUCTION = 'Production_update_APRIL_2026.xlsx';

const dj = dataJson as unknown as {
  skus: { line: string; model: string; colour: string; opening: number; sold: number; closing: number }[];
  machines: { name: string; fresh: number }[];
};

describe('parseWorkbook — Master SKU List', () => {
  let parsed: ParsedWorkbook;
  it('parses 605 real SKUs across 27 lines (summary/grand-total rows excluded)', async () => {
    parsed = await parseWorkbook(fixture(MASTER));
    // 696 raw rows − 91 Fresh/Total/G.Total/C-Mix/G.Rejn grand-total rows = 605 real SKUs.
    expect(parsed.skus.length).toBe(605);
    expect(parsed.lines.length).toBe(27);
    expect(parsed.machines.length).toBe(0); // master file has no machine tabs
    // no summary/grand-total row leaked in as a fake SKU
    expect(parsed.skus.some((s) => /^(fresh|total|g\.total|c-mix|g\.rejn)$/i.test(s.colour))).toBe(false);
  });

  it('REGRESSION Bug 1: reads the Closing column, not "Opening Stock"', async () => {
    parsed = parsed ?? (await parseWorkbook(fixture(MASTER)));
    const byId = new Map(parsed.skus.map((s) => [skuId(s), s]));
    // Row where opening and closing genuinely differ — the old parser reported closing===opening.
    const bSilver = byId.get('BIG CHAIR||2001(New)||B.Silver')!;
    expect(bSilver.opening).toBe(1264);
    expect(bSilver.closing).toBe(1232); // NOT 1264
    expect(bSilver.closing).not.toBe(bSilver.opening);

    const sw = byId.get('BIG CHAIR||2001(New)||S-W')!;
    expect(sw.opening).toBe(976);
    expect(sw.closing).toBe(0); // fully sold out — NOT 976
  });

  it('the consolidated production file reproduces the demo seed data.json', async () => {
    // data.json is generated from consolidating the April production file, so the
    // parse of that file must match it row-for-row (duplicate-safe multiset compare).
    const prod = await parseWorkbook(fixture(PRODUCTION));
    const key = (s: { line: string; model: string; colour: string; opening: number; sold: number; closing: number }) =>
      [s.line, s.model, s.colour, Math.round(s.opening), Math.round(s.sold), Math.round(s.closing)].join('|');
    const a = prod.skus.map(key).sort();
    const b = dj.skus.map(key).sort();
    expect(a).toEqual(b);
  });

  it('CHARACTERIZATION: the source contains duplicate SKU ids (596 unique of 605)', async () => {
    parsed = parsed ?? (await parseWorkbook(fixture(MASTER)));
    const counts = new Map<string, number>();
    for (const s of parsed.skus) counts.set(skuId(s), (counts.get(skuId(s)) ?? 0) + 1);
    const dupes = [...counts.values()].filter((n) => n > 1);
    expect(counts.size).toBe(596);
    expect(dupes.length).toBe(9);
    // Same-key rows must not silently overwrite each other — see normalizeDataset.
  });

  it('stores whole-piece integers', async () => {
    parsed = parsed ?? (await parseWorkbook(fixture(MASTER)));
    expect(parsed.skus.every((s) => Number.isInteger(s.closing) && Number.isInteger(s.opening) && Number.isInteger(s.sold))).toBe(true);
  });

  it('forward-fills the product line down each group', async () => {
    parsed = parsed ?? (await parseWorkbook(fixture(MASTER)));
    // The 2nd+ rows of BIG CHAIR have a blank line cell in the source; all must carry the line.
    const bigChair = parsed.skus.filter((s) => s.line === 'BIG CHAIR');
    expect(bigChair.length).toBeGreaterThan(5);
    expect(parsed.skus.every((s) => s.line.length > 0)).toBe(true);
  });
});

describe('parseWorkbook — Production machine tabs', () => {
  it('reads 7 machines and the full Fresh band total', async () => {
    const parsed = await parseWorkbook(fixture(PRODUCTION));
    expect(parsed.machines.length).toBe(7);
    expect(parsed.machines.map((m) => m.name)).toEqual(['M-1', 'M-2', 'M-3', 'M-4', 'M-5', 'M-6', 'M-7']);
  });

  it('CONSOLIDATOR: a raw production file yields per-SKU data from its 27 product tabs', async () => {
    const parsed = await parseWorkbook(fixture(PRODUCTION));
    expect(parsed.consolidation?.tabs).toBe(27);
    expect(parsed.consolidation?.skipped).toEqual([]);
    expect(parsed.skus.length).toBe(601);
    // real April closing/sold, matching the reconciliation (NOT the ~4x-inflated Master)
    const ds = normalizeDataset({ skus: parsed.skus, lines: parsed.lines, machines: [] });
    const k = kpis(eff(ds, {}, DEFAULT_THRESHOLDS));
    expect(k.totalStock).toBe(96615);
    expect(k.totalSold).toBe(114242);
  });

  it('REGRESSION: reads formula cells in the Fresh band (was undercounting ~4x)', async () => {
    // The machine tabs store daily Fresh values as formulas: <c ...><f/><v>N</v></c>.
    // An earlier reader matched only value-first cells and skipped formulas, so the
    // total read 68,838 instead of the true 266,088 (verified against openpyxl).
    const parsed = await parseWorkbook(fixture(PRODUCTION));
    const total = parsed.machines.reduce((a, m) => a + m.fresh, 0);
    expect(total).toBe(266088);
    expect(parsed.machines.find((m) => m.name === 'M-1')!.fresh).toBe(37992);
    expect(total).toBeGreaterThan(68838 * 3); // not the old undercount
  });
});

describe('de-polluted Master totals (summary rows excluded)', () => {
  it('net stock and sold are the REAL figures, not the ~4x-inflated Master', async () => {
    const parsed = await parseWorkbook(fixture(MASTER));
    const ds = normalizeDataset({ skus: parsed.skus, lines: parsed.lines, machines: [] });
    const k = kpis(eff(ds, {}, DEFAULT_THRESHOLDS));
    // Excluding the 91 grand-total rows: closing 96,927 (not the polluted 392,311),
    // sold 114,278 (not 445,655). Matches the consolidated production file (~96,615).
    expect(k.totalStock).toBe(96927);
    expect(k.totalSold).toBe(114278);
  });

  it('status counts on the real data sum to the real SKU count', async () => {
    const parsed = await parseWorkbook(fixture(MASTER));
    const ds = normalizeDataset({ skus: parsed.skus, lines: parsed.lines, machines: [] });
    const counts = statusCounts(eff(ds, {}, DEFAULT_THRESHOLDS));
    expect(counts.Negative).toBe(28);
    expect(counts.Overstock).toBe(49);
    expect(counts['No activity']).toBe(357);
    expect(counts.Low).toBe(36);
    expect(counts.Negative + counts.Low + counts.Overstock + counts['No activity'] + counts.OK).toBe(605);
  });
});

describe('merge-aware apply (Bug 2 fix)', () => {
  const current: Dataset = {
    skus: [{ line: 'L', model: 'M', colour: 'C', opening: 1, sold: 1, closing: 1 }],
    lines: ['L'],
    machines: [{ name: 'M-1', fresh: 5, activeDays: 1 }],
  };

  it('a machines-only file updates machines but KEEPS existing SKUs', async () => {
    // A file with machine tabs but no product tabs (skus empty) must not wipe SKUs.
    const parsed: ParsedWorkbook = { skus: [], lines: [], machines: [{ name: 'M-1', fresh: 99, activeDays: 1 }], sheetNames: [] };
    const next = applyParsedToDataset(current, parsed);
    expect(next.skus).toBe(current.skus);        // SKUs untouched — not wiped
    expect(next.machines.length).toBe(1);        // machines replaced
  });

  it('a master-only import updates SKUs but KEEPS existing machines', async () => {
    const parsed = await parseWorkbook(fixture(MASTER));
    const next = applyParsedToDataset(current, parsed);
    expect(next.skus.length).toBe(605);
    expect(next.machines).toBe(current.machines); // machines untouched
  });
});

describe('mergeParsed — importing multiple files at once', () => {
  it('a production file is self-sufficient (SKUs + machines from one file)', async () => {
    // Since the consolidator reads the product tabs, a single production file now
    // carries both per-SKU data and machine output — no separate Master needed.
    const production = await parseWorkbook(fixture(PRODUCTION));
    expect(production.skus.length).toBe(601);
    expect(production.machines.length).toBe(7);
    expect(summarizeParse(production).ok).toBe(true);
  });

  it('merges machine tabs by name without double-counting an overlap', () => {
    const a: ParsedWorkbook = { skus: [], lines: [], machines: [{ name: 'M-1', fresh: 100, activeDays: 2 }], sheetNames: [] };
    const b: ParsedWorkbook = { skus: [], lines: [], machines: [{ name: 'M-1', fresh: 150, activeDays: 3 }, { name: 'M-2', fresh: 50, activeDays: 1 }], sheetNames: [] };
    const merged = mergeParsed([a, b]);
    expect(merged.machines.map((m) => m.name)).toEqual(['M-1', 'M-2']); // one M-1, not two
    expect(merged.machines.find((m) => m.name === 'M-1')!.fresh).toBe(150); // later file wins
  });

  it('keeps every SKU row (dedup of same-key rows happens later in normalizeDataset)', () => {
    const row = { line: 'L', model: 'M', colour: 'C', opening: 0, sold: 1, closing: 10 };
    const merged = mergeParsed([
      { skus: [row], lines: ['L'], machines: [], sheetNames: [] },
      { skus: [row], lines: ['L'], machines: [], sheetNames: [] },
    ]);
    expect(merged.skus.length).toBe(2); // no silent data loss
  });
});

describe('preserveOverrides', () => {
  it('keeps reorder + note, drops stale stock/sold', () => {
    const kept = preserveOverrides({
      a: { closing: 5, sold: 3, reorder: 40, note: 'x' },
      b: { closing: 10 },          // no reorder/note → dropped entirely
      c: { note: 'keep me' },
    });
    expect(kept).toEqual({ a: { reorder: 40, note: 'x' }, c: { note: 'keep me' } });
  });
});

describe('summarizeParse', () => {
  it('summarizes a master workbook', async () => {
    const s = summarizeParse(await parseWorkbook(fixture(MASTER)));
    expect(s.ok).toBe(true);
    expect(s.message).toContain('605 SKUs across 27 lines');
  });
  it('summarizes a production workbook', async () => {
    const s = summarizeParse(await parseWorkbook(fixture(PRODUCTION)));
    expect(s.ok).toBe(true);
    expect(s.message).toContain('7 machine tabs');
    expect(s.message).toContain('2,66,088'); // Indian grouping of 266088
  });
  it('flags a workbook with no recognised sheets', () => {
    const s = summarizeParse({ skus: [], lines: [], machines: [], sheetNames: ['Sheet1'] });
    expect(s.ok).toBe(false);
    expect(s.message).toContain('Could not find');
  });
});

describe('unzip guard', () => {
  it('rejects a non-xlsx blob', async () => {
    await expect(parseWorkbook(new Blob(['not a zip']))).rejects.toThrow(/valid .xlsx/);
  });
});
