import { describe, it, expect } from 'vitest';
import { orderNo, orderStatus, orderProgress, orderBook, ordersToKeepOnScrub, itemPending } from '../orders';
import type { Order, OrderItem } from '../types';

const item = (o: number, f: number): OrderItem => ({ uid: 'u', line: 'L', model: 'M', colour: 'C', qtyOrdered: o, qtyFulfilled: f });
const order = (items: OrderItem[], extra: Partial<Order> = {}): Order => ({
  id: 'ORD-0001', no: 1, dealer: 'D', date: '2026-04-01', createdAt: 0, items, ...extra,
});

describe('orderNo', () => {
  it('zero-pads', () => {
    expect(orderNo(7)).toBe('ORD-0007');
    expect(orderNo(1234)).toBe('ORD-1234');
  });
});

describe('orderStatus', () => {
  it('open when nothing dispatched', () => {
    expect(orderStatus(order([item(10, 0), item(5, 0)]))).toBe('open');
  });
  it('partial when some but not all dispatched', () => {
    expect(orderStatus(order([item(10, 10), item(5, 0)]))).toBe('partial');
    expect(orderStatus(order([item(10, 4)]))).toBe('partial');
  });
  it('fulfilled when every line is met', () => {
    expect(orderStatus(order([item(10, 10), item(5, 5)]))).toBe('fulfilled');
  });
  it('cancelled overrides', () => {
    expect(orderStatus(order([item(10, 10)], { cancelled: true }))).toBe('cancelled');
  });
});

describe('orderProgress + itemPending', () => {
  it('totals ordered/fulfilled/pending', () => {
    const p = orderProgress(order([item(10, 4), item(6, 6)]));
    expect(p).toEqual({ ordered: 16, fulfilled: 10, pending: 6, pct: 63 });
  });
  it('itemPending never negative', () => {
    expect(itemPending(item(5, 8))).toBe(0);
    expect(itemPending(item(5, 2))).toBe(3);
  });
});

describe('orderBook', () => {
  const orders = [
    order([item(10, 10)], { id: 'ORD-0001' }),                 // fulfilled
    order([item(10, 4)], { id: 'ORD-0002' }),                  // partial
    order([item(8, 0), item(2, 0)], { id: 'ORD-0003' }),       // open
    order([item(5, 0)], { id: 'ORD-0004', cancelled: true }),  // cancelled (ignored)
  ];
  it('counts open orders, pending units/lines, and fill rate', () => {
    const b = orderBook(orders);
    expect(b.openOrders).toBe(2);            // partial + open
    expect(b.pendingUnits).toBe(6 + 8 + 2);  // 16
    expect(b.pendingLines).toBe(3);
    // fill rate over non-cancelled: fulfilled 14 / ordered 30
    expect(b.fillRate).toBe(Math.round((14 / 30) * 100));
  });
});

describe('ordersToKeepOnScrub', () => {
  it('keeps open + partial, drops fulfilled + cancelled', () => {
    const kept = ordersToKeepOnScrub([
      order([item(10, 10)], { id: 'a' }),
      order([item(10, 3)], { id: 'b' }),
      order([item(10, 0)], { id: 'c' }),
      order([item(10, 0)], { id: 'd', cancelled: true }),
    ]);
    expect(kept.map((o) => o.id)).toEqual(['b', 'c']);
  });
});
