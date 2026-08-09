import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWorkbook } from '../parseWorkbook';
import { applyParsedToDataset, preserveOverrides, summarizeParse } from '../applyImport';
import { skuId, eff, normalizeDataset, statusCounts } from '../logic';
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
  it('parses 696 SKUs across 27 lines', async () => {
    parsed = await parseWorkbook(fixture(MASTER));
    expect(parsed.skus.length).toBe(696);
    expect(parsed.lines.length).toBe(27);
    expect(parsed.machines.length).toBe(0); // master file has no machine tabs
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

  it('reproduces data.json exactly (duplicate-safe: compare the multiset of rows)', async () => {
    parsed = parsed ?? (await parseWorkbook(fixture(MASTER)));
    // The source has duplicate line||model||colour ids, so compare as a multiset of
    // full rows rather than by id (which would collide). Quantities are whole pieces.
    const key = (s: { line: string; model: string; colour: string; opening: number; sold: number; closing: number }) =>
      [s.line, s.model, s.colour, Math.round(s.opening), Math.round(s.sold), Math.round(s.closing)].join('|');
    const a = parsed.skus.map(key).sort();
    const b = dj.skus.map(key).sort();
    expect(a).toEqual(b);
  });

  it('CHARACTERIZATION: the source contains 9 duplicate SKU ids (687 unique of 696)', async () => {
    parsed = parsed ?? (await parseWorkbook(fixture(MASTER)));
    const counts = new Map<string, number>();
    for (const s of parsed.skus) counts.set(skuId(s), (counts.get(skuId(s)) ?? 0) + 1);
    const dupes = [...counts.values()].filter((n) => n > 1);
    expect(counts.size).toBe(687);
    expect(dupes.length).toBe(9);
    // 4 of those duplicates have one populated copy and one all-zero copy —
    // a plain id→doc map would silently drop real stock. This is why we assign
    // unique doc ids (see assignUniqueIds) instead of trusting line||model||colour.
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
    expect(parsed.skus.length).toBe(0); // no SKU sheet in this file
    expect(parsed.machines.length).toBe(7);
    expect(parsed.machines.map((m) => m.name)).toEqual(['M-1', 'M-2', 'M-3', 'M-4', 'M-5', 'M-6', 'M-7']);
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

describe('status counts reconcile with the Master workbook Alerts tab', () => {
  it('matches the client spreadsheet (Negative 28 · Low ~50 · Overstock 76 · No activity 363)', async () => {
    const parsed = await parseWorkbook(fixture(MASTER));
    const ds = normalizeDataset({ skus: parsed.skus, lines: parsed.lines, machines: [] });
    const counts = statusCounts(eff(ds, {}, DEFAULT_THRESHOLDS));
    // The workbook's own Alerts sheet: Negative 28, Low 50, Overstock 76, No Activity 363, OK 179.
    // We keep an editable reorder point, so Low is 51 (one SKU sits exactly at 0.5-month cover).
    expect(counts.Negative).toBe(28);
    expect(counts.Overstock).toBe(76);
    expect(counts['No activity']).toBe(363);
    expect(counts.Low).toBeGreaterThanOrEqual(50);
    expect(counts.Low).toBeLessThanOrEqual(51);
    expect(counts.Negative + counts.Low + counts.Overstock + counts['No activity'] + counts.OK).toBe(696);
  });
});

describe('merge-aware apply (Bug 2 fix)', () => {
  const current: Dataset = {
    skus: [{ line: 'L', model: 'M', colour: 'C', opening: 1, sold: 1, closing: 1 }],
    lines: ['L'],
    machines: [{ name: 'M-1', fresh: 5, activeDays: 1 }],
  };

  it('a production-only import updates machines but KEEPS existing SKUs', async () => {
    const parsed = await parseWorkbook(fixture(PRODUCTION));
    const next = applyParsedToDataset(current, parsed);
    expect(next.skus).toBe(current.skus);        // SKUs untouched — not wiped
    expect(next.machines.length).toBe(7);        // machines replaced
  });

  it('a master-only import updates SKUs but KEEPS existing machines', async () => {
    const parsed = await parseWorkbook(fixture(MASTER));
    const next = applyParsedToDataset(current, parsed);
    expect(next.skus.length).toBe(696);
    expect(next.machines).toBe(current.machines); // machines untouched
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
    expect(s.message).toContain('696 SKUs across 27 lines');
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
