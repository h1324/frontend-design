import { describe, it, expect } from 'vitest';
import { sellThrough, valuation, deadStock, pendingOrderValue } from '../metrics';
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
