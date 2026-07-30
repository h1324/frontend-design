import { describe, it, expect } from 'vitest';
import {
  skuId, normalizeDataset, effectiveId, resolveThreshold, reorderDefault, computeCover,
  classify, effOne, eff, lineSummaries, statusCounts, kpis,
} from '../logic';
import type { Overrides, RawSku, Thresholds } from '../types';

const T = (lowMonths = 1, overMonths = 6, byLine = {}): Thresholds => ({ lowMonths, overMonths, byLine });
const raw = (p: Partial<RawSku>): RawSku => ({ line: 'L', model: 'M', colour: 'C', opening: 0, sold: 0, closing: 0, ...p });

describe('skuId', () => {
  it('joins line||model||colour', () => {
    expect(skuId({ line: 'BIG CHAIR', model: '2001', colour: 'S-W' })).toBe('BIG CHAIR||2001||S-W');
  });
});

describe('normalizeDataset — unique ids for duplicate rows', () => {
  it('suffixes colliding line||model||colour so no doc silently overwrites another', () => {
    const ds = {
      lines: ['L'],
      machines: [],
      skus: [
        raw({ model: 'A', closing: 10 }),
        raw({ model: 'A', closing: 0 }),   // duplicate id, different data
        raw({ model: 'B', closing: 5 }),
      ],
    };
    const n = normalizeDataset(ds);
    const ids = n.skus.map(effectiveId);
    expect(new Set(ids).size).toBe(3);              // all unique
    expect(ids[0]).toBe('L||A||C');
    expect(ids[1]).toBe('L||A||C #2');
    expect(ids[2]).toBe('L||B||C');
    // Both duplicate rows survive with their own values (no data loss).
    const e = eff(n, {}, T());
    expect(e.find((s) => s.id === 'L||A||C')!.closing).toBe(10);
    expect(e.find((s) => s.id === 'L||A||C #2')!.closing).toBe(0);
  });
});

describe('reorderDefault', () => {
  it('is round(sold * lowMonths)', () => {
    expect(reorderDefault(40, 1)).toBe(40);
    expect(reorderDefault(41, 0.5)).toBe(21);   // 20.5 → 21
    expect(reorderDefault(41, 1.5)).toBe(62);   // 61.5 → 62
  });
});

describe('computeCover (months of cover)', () => {
  it('closing / sold when sold > 0', () => {
    expect(computeCover(80, 40)).toBe(2);
    expect(computeCover(50, 40)).toBeCloseTo(1.25);
  });
  it('is ∞ (999) when stock exists but nothing sold', () => {
    expect(computeCover(100, 0)).toBe(999);
  });
  it('is 0 when empty and nothing sold', () => {
    expect(computeCover(0, 0)).toBe(0);
    expect(computeCover(-5, 0)).toBe(0);
  });
});

describe('classify — status precedence', () => {
  const base = { reorder: 10, overMonths: 6 };
  it('Negative wins whenever closing < 0 (even with sales)', () => {
    expect(classify({ ...base, closing: -1, sold: 5, produced: 0, cover: -0.2 })).toBe('Negative');
  });
  it('Empty: no movement and closing ≤ 0', () => {
    expect(classify({ ...base, closing: 0, sold: 0, produced: 0, cover: 0 })).toBe('Empty');
  });
  it('No activity: no movement but stock on hand', () => {
    expect(classify({ ...base, closing: 100, sold: 0, produced: 0, cover: 999 })).toBe('No activity');
  });
  it('produced≠0 counts as movement (so not No activity/Empty)', () => {
    // opening 100 → closing 0, sold 0, produced -100: moved, sold not >0 → OK
    expect(classify({ ...base, closing: 0, sold: 0, produced: -100, cover: 0 })).toBe('OK');
  });
  it('Low: demand and at/below reorder point', () => {
    expect(classify({ ...base, closing: 10, sold: 20, produced: 0, cover: 0.5, reorder: 20 })).toBe('Low');
  });
  it('Overstock: demand and cover beyond overMonths', () => {
    expect(classify({ ...base, closing: 700, sold: 100, produced: 0, cover: 7, reorder: 100 })).toBe('Overstock');
  });
  it('Low takes precedence over Overstock when both would trigger', () => {
    // closing <= reorder AND cover > overMonths
    expect(classify({ closing: 100, sold: 10, produced: 0, cover: 10, reorder: 200, overMonths: 6 })).toBe('Low');
  });
  it('OK otherwise', () => {
    expect(classify({ ...base, closing: 100, sold: 50, produced: 0, cover: 2, reorder: 40 })).toBe('OK');
  });
});

describe('effOne — overrides + derived fields', () => {
  it('applies sold/closing/reorder/note overrides', () => {
    const ov: Overrides = { 'L||M||C': { closing: 5, sold: 50, reorder: 99, note: 'hi' } };
    const e = effOne(raw({ opening: 10, sold: 1, closing: 1 }), ov, T());
    expect(e.closing).toBe(5);
    expect(e.sold).toBe(50);
    expect(e.reorder).toBe(99);
    expect(e.note).toBe('hi');
    expect(e.produced).toBe(5 + 50 - 10);
  });
  it('defaults reorder to round(sold * lowMonths) when not overridden', () => {
    const e = effOne(raw({ sold: 40, closing: 80 }), {}, T(1));
    expect(e.reorder).toBe(40);
    expect(e.status).toBe('OK');
  });
  it('rounds quantities to whole pieces', () => {
    const e = effOne(raw({ opening: 10.4, sold: 2.6, closing: 7.5 }), {}, T());
    expect(e.opening).toBe(10);
    expect(e.sold).toBe(3);
    expect(e.closing).toBe(8);
  });
});

describe('per-line thresholds', () => {
  it('resolveThreshold falls back to global default', () => {
    const t = T(1, 6, { XUV: { overMonths: 3 } });
    expect(resolveThreshold(t, 'XUV')).toEqual({ lowMonths: 1, overMonths: 3 });
    expect(resolveThreshold(t, 'OTHER')).toEqual({ lowMonths: 1, overMonths: 6 });
  });
  it('a per-line overMonths flips a SKU into Overstock', () => {
    const sku = raw({ line: 'XUV', sold: 100, closing: 500 }); // cover = 5
    expect(effOne(sku, {}, T(1, 6)).status).toBe('OK');              // 5 !> 6
    expect(effOne(sku, {}, T(1, 6, { XUV: { overMonths: 3 } })).status).toBe('Overstock'); // 5 > 3
  });
  it('a per-line lowMonths raises the reorder point and flips into Low', () => {
    const sku = raw({ line: 'XUV', sold: 100, closing: 150 });
    expect(effOne(sku, {}, T(1)).status).toBe('OK');   // reorder 100, closing 150 > 100
    expect(effOne(sku, {}, T(1, 6, { XUV: { lowMonths: 2 } })).status).toBe('Low'); // reorder 200 ≥ 150
  });
});

describe('threshold recomputation across the dataset', () => {
  const skus = [
    raw({ model: 'a', sold: 100, closing: 500 }), // cover 5
    raw({ model: 'b', sold: 100, closing: 90 }),  // cover 0.9 → Low at lowMonths 1
    raw({ model: 'c', sold: 0, closing: 100 }),   // No activity
  ];
  const ds = { skus, lines: ['L'], machines: [] };
  it('raising overMonths removes overstock flags', () => {
    const many = eff(ds, {}, T(1, 4)); // cover 5 > 4 → b is Low, a is Overstock
    expect(statusCounts(many).Overstock).toBe(1);
    const fewer = eff(ds, {}, T(1, 6)); // cover 5 !> 6
    expect(statusCounts(fewer).Overstock).toBe(0);
  });
});

describe('aggregations', () => {
  const ds = {
    lines: ['L'],
    machines: [],
    skus: [
      raw({ model: 'a', opening: 100, sold: 40, closing: 60 }),
      raw({ model: 'b', opening: 0, sold: 0, closing: -5 }),   // Negative, excluded from stock
    ],
  };
  const e = eff(ds, {}, T());
  it('kpis sum stock as Σ max(0, closing) and count urgents', () => {
    const k = kpis(e);
    expect(k.totalStock).toBe(60);      // negative row contributes 0
    expect(k.totalSold).toBe(40);
    expect(k.negativeCount).toBe(1);
    expect(k.urgent).toBe(k.negativeCount + k.lowCount);
  });
  it('lineSummaries flags negative + low', () => {
    const [L] = lineSummaries(e);
    expect(L.stock).toBe(60);
    expect(L.flagged).toBe(1);
    expect(L.count).toBe(2);
  });
});
