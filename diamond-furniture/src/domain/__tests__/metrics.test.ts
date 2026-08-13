import { describe, it, expect } from 'vitest';
import { sellThrough, avgDaysCover, valuation, deadStock, pendingOrderValue, lastSaleInfo, productionPlan } from '../metrics';
import { effWithHistory } from '../logic';
import type { CatalogSku, EffSku, Order, PeriodSnapshot, Thresholds } from '../types';

const T: Thresholds = { lowMonths: 0.5, overMonths: 3, byLine: {} };
const e = (p: Partial<EffSku>): EffSku => ({
  uid: 'u', id: 'u', line: 'L', model: 'M', colour: 'C', opening: 0, sold: 0, closing: 0,
  reorder: 0, note: '', produced: 0, demand: 0, cover: 0, status: 'OK', price: 0, idle: false,
  lowMonths: 0.5, overMonths: 3, ...p,
});

describe('sellThrough', () => {
  it('sold ÷ (sold + stock)', () => {
    expect(sellThrough([e({ sold: 40, closing: 60 })])).toBe(40);      // 40/100
    expect(sellThrough([e({ sold: 100, closing: 0 })])).toBe(100);
    expect(sellThrough([e({ sold: 0, closing: 0 })])).toBe(0);
  });
});

describe('avgDaysCover', () => {
  it('uses the median so one dormant pile does not dominate', () => {
    // Three normal SKUs (~1 month) + one slow-mover holding 500 months of stock.
    const effs = [
      e({ demand: 10, cover: 1 }), e({ demand: 10, cover: 1 }),
      e({ demand: 10, cover: 2 }), e({ demand: 1, cover: 500 }),
    ];
    expect(avgDaysCover(effs)).toBe(45); // median cover 1.5 mo × 30 — not skewed by the 500
  });
  it('ignores SKUs with no demand and returns 0 when none qualify', () => {
    expect(avgDaysCover([e({ demand: 0, cover: 999 })])).toBe(0);
  });
});

describe('valuation', () => {
  it('is zero and hasPrice=false without prices', () => {
    const v = valuation([e({ closing: 100 }), e({ closing: 50, status: 'Overstock' })]);
    expect(v).toEqual({ hasPrice: false, stockValue: 0, overstockValue: 0, idleValue: 0 });
  });
  it('values stock, overstock and idle when prices exist', () => {
    const v = valuation([
      e({ closing: 10, price: 100 }),                                   // 1000 stock
      e({ closing: 5, price: 200, status: 'Overstock' }),              // 1000 stock + overstock
      e({ closing: 4, price: 50, idle: true }),                         // 200 stock + idle
    ]);
    expect(v.hasPrice).toBe(true);
    expect(v.stockValue).toBe(1000 + 1000 + 200);
    expect(v.overstockValue).toBe(1000);
    expect(v.idleValue).toBe(200);
  });
});

describe('deadStock', () => {
  const catalog: CatalogSku[] = [
    { uid: 'a', line: 'L', model: 'A', colour: 'c' }, // stock, no sales in any month → dead
    { uid: 'b', line: 'L', model: 'B', colour: 'c' }, // sold last month → not dead
  ];
  const snap = (key: string, rows: PeriodSnapshot['rows']): PeriodSnapshot => ({ key, label: key, machines: [], rows });
  const m3 = snap('2026-03', [{ uid: 'a', opening: 0, sold: 0, closing: 100 }, { uid: 'b', opening: 0, sold: 0, closing: 50 }]);
  const m4 = snap('2026-04', [{ uid: 'a', opening: 0, sold: 0, closing: 100 }, { uid: 'b', opening: 0, sold: 30, closing: 50 }]);
  it('flags stock-holding SKUs with no sales across the window', () => {
    const effs = effWithHistory(catalog, m4, [m3, m4], {}, T);
    const dead = deadStock(effs, [m3, m4]);
    expect(dead.map((d) => d.uid)).toEqual(['a']);
  });
});

describe('lastSaleInfo', () => {
  const snap = (key: string, rows: PeriodSnapshot['rows']): PeriodSnapshot => ({ key, label: key, machines: [], rows });
  const snaps = [
    snap('2026-02', [{ uid: 'a', opening: 0, sold: 5, closing: 100 }]),
    snap('2026-03', [{ uid: 'a', opening: 0, sold: 0, closing: 100 }]),
    snap('2026-04', [{ uid: 'a', opening: 0, sold: 0, closing: 100 }]),
  ];
  it('reports months since the last month with a sale', () => {
    expect(lastSaleInfo('a', snaps, '2026-04')).toEqual({ lastKey: '2026-02', lastLabel: '2026-02', monthsSince: 2 });
  });
  it('is 0 when sold in the current month', () => {
    expect(lastSaleInfo('a', snaps, '2026-02').monthsSince).toBe(0);
  });
  it('is null when never sold', () => {
    expect(lastSaleInfo('b', snaps, '2026-04')).toEqual({ lastKey: null, lastLabel: null, monthsSince: null });
  });
});

describe('productionPlan', () => {
  it('suggests making up to demand + reorder, biggest need first', () => {
    const plan = productionPlan([
      e({ uid: 'x', demand: 100, reorder: 50, closing: 40 }), // 100+50-40 = 110
      e({ uid: 'y', demand: 20, reorder: 10, closing: 5 }),   // 20+10-5  = 25
      e({ uid: 'z', demand: 30, reorder: 15, closing: 500 }), // overstocked → 0, dropped
    ]);
    expect(plan.map((p) => [p.eff.uid, p.make])).toEqual([['x', 110], ['y', 25]]);
  });
  it('replenishes negative stock', () => {
    expect(productionPlan([e({ uid: 'n', demand: 100, reorder: 50, closing: -20 })])[0].make).toBe(170);
  });
});

describe('pendingOrderValue', () => {
  it('sums pending units × price, ignoring cancelled', () => {
    const orders: Order[] = [
      { id: 'o1', no: 1, dealer: 'D', date: '', createdAt: 0, items: [{ uid: 'a', line: 'L', model: 'A', colour: 'c', qtyOrdered: 10, qtyFulfilled: 4 }] },
      { id: 'o2', no: 2, dealer: 'D', date: '', createdAt: 0, cancelled: true, items: [{ uid: 'a', line: 'L', model: 'A', colour: 'c', qtyOrdered: 5, qtyFulfilled: 0 }] },
    ];
    const price = new Map([['a', 100]]);
    expect(pendingOrderValue(orders, price)).toBe(6 * 100); // 6 pending × 100
  });
});
