import { describe, it, expect } from 'vitest';
import { effWithHistory, periodTotals, lineTrend, skuHistory } from '../logic';
import type { CatalogSku, PeriodSnapshot, Thresholds } from '../types';

const T: Thresholds = { lowMonths: 0.5, overMonths: 3, byLine: {} };
const catalog: CatalogSku[] = [
  { uid: 'XUV||m||c', line: 'XUV', model: 'm', colour: 'c' },
];
const snap = (key: string, sold: number, closing: number): PeriodSnapshot => ({
  key, label: key, machines: [{ name: 'M-1', fresh: 100, activeDays: 1 }],
  rows: [{ uid: 'XUV||m||c', opening: 0, sold, closing }],
});

describe('effWithHistory — 3-month demand forecast', () => {
  it('with one month, demand = that month (matches single-month behaviour)', () => {
    const cur = snap('2026-04', 100, 500);
    const [e] = effWithHistory(catalog, cur, [cur], {}, T);
    expect(e.demand).toBe(100);
    expect(e.cover).toBe(5);          // 500 / 100
    expect(e.status).toBe('Overstock'); // 5 > 3
    expect(e.sold).toBe(100);
  });

  it('averages sold over the trailing months for demand/cover', () => {
    const m2 = snap('2026-02', 40, 400);
    const m3 = snap('2026-03', 20, 300);
    const m4 = snap('2026-04', 0, 300); // no sales THIS month
    const [e] = effWithHistory(catalog, m4, [m2, m3, m4], {}, T);
    expect(e.demand).toBe((40 + 20 + 0) / 3); // 20
    expect(e.sold).toBe(0);                    // current month
    expect(e.cover).toBe(15);                  // 300 / 20
    expect(e.status).toBe('Overstock');
    expect(e.idle).toBe(true);                 // stock, no sales this month
  });

  it('a SKU absent from a month is NOT counted as a zero-sales month', () => {
    // The SKU only exists in April (m4), so its demand is April's alone — the
    // empty March must not drag the average down (a new-product forecast fix).
    const m3: PeriodSnapshot = { key: '2026-03', label: 'x', machines: [], rows: [] };
    const m4 = snap('2026-04', 60, 10);
    const [e] = effWithHistory(catalog, m4, [m3, m4], {}, T);
    expect(e.demand).toBe(60);     // 60 / 1 (present in one month only)
    expect(e.status).toBe('Low');  // reorder round(60*0.5)=30; closing 10 <= 30 → Low
  });

  it('counts a month where the SKU exists but sold zero', () => {
    // Present in both months (April sold 0) → averaged over 2, not treated as absent.
    const m3 = snap('2026-03', 40, 200);
    const m4 = snap('2026-04', 0, 200);
    const [e] = effWithHistory(catalog, m4, [m3, m4], {}, T);
    expect(e.demand).toBe(20);     // (40 + 0) / 2
  });
});

describe('trend aggregations', () => {
  const snaps = [snap('2026-04', 100, 500), snap('2026-02', 40, 400), snap('2026-03', 20, 300)];
  it('periodTotals sorts oldest → newest with sold/stock/fresh', () => {
    const t = periodTotals(snaps);
    expect(t.map((x) => x.key)).toEqual(['2026-02', '2026-03', '2026-04']);
    expect(t[0].sold).toBe(40);
    expect(t[2].stock).toBe(500);
    expect(t[0].fresh).toBe(100);
  });
  it('lineTrend filters to a product line', () => {
    const t = lineTrend(catalog, snaps, 'XUV');
    expect(t.map((x) => x.sold)).toEqual([40, 20, 100]);
    expect(lineTrend(catalog, snaps, 'OTHER').every((x) => x.sold === 0)).toBe(true);
  });
  it('skuHistory returns one SKU across months, oldest → newest', () => {
    const h = skuHistory('XUV||m||c', snaps);
    expect(h.map((x) => x.key)).toEqual(['2026-02', '2026-03', '2026-04']);
    expect(h.map((x) => x.sold)).toEqual([40, 20, 100]);
    expect(h.map((x) => x.closing)).toEqual([400, 300, 500]);
    // A uid not in the data reads as zeros, not a crash.
    expect(skuHistory('nope', snaps).every((x) => x.sold === 0 && x.closing === 0)).toBe(true);
  });
});
