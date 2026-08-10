import type { Order, OrderItem, OrderStatus } from './types';

/** Zero-padded order id from a sequence number: 7 → 'ORD-0007'. */
export function orderNo(seq: number): string {
  return `ORD-${String(seq).padStart(4, '0')}`;
}

const itemDone = (i: OrderItem) => i.qtyFulfilled >= i.qtyOrdered;

/** Derive an order's status from its lines + cancelled flag. */
export function orderStatus(order: Order): OrderStatus {
  if (order.cancelled) return 'cancelled';
  const fulfilled = order.items.reduce((a, i) => a + i.qtyFulfilled, 0);
  if (fulfilled <= 0) return 'open';
  return order.items.every(itemDone) ? 'fulfilled' : 'partial';
}

export interface OrderProgress {
  ordered: number;
  fulfilled: number;
  pending: number;
  pct: number; // 0–100
}

export function orderProgress(order: Order): OrderProgress {
  const ordered = order.items.reduce((a, i) => a + i.qtyOrdered, 0);
  const fulfilled = order.items.reduce((a, i) => a + Math.min(i.qtyFulfilled, i.qtyOrdered), 0);
  return { ordered, fulfilled, pending: Math.max(0, ordered - fulfilled), pct: ordered > 0 ? Math.round((fulfilled / ordered) * 100) : 0 };
}

/** How many units of a line remain to be dispatched. */
export function itemPending(item: OrderItem): number {
  return Math.max(0, item.qtyOrdered - item.qtyFulfilled);
}

export interface OrderBook {
  openOrders: number;      // orders still open or partial
  pendingUnits: number;    // units still to dispatch across those orders
  pendingLines: number;    // line items still to dispatch
  fillRate: number;        // 0–100: fulfilled ÷ ordered units, excluding cancelled
}

export function orderBook(orders: Order[]): OrderBook {
  let openOrders = 0, pendingUnits = 0, pendingLines = 0, ordered = 0, fulfilled = 0;
  for (const o of orders) {
    if (o.cancelled) continue;
    const st = orderStatus(o);
    if (st === 'open' || st === 'partial') openOrders += 1;
    for (const it of o.items) {
      ordered += it.qtyOrdered;
      fulfilled += Math.min(it.qtyFulfilled, it.qtyOrdered);
      const p = itemPending(it);
      if (p > 0) { pendingUnits += p; pendingLines += 1; }
    }
  }
  return { openOrders, pendingUnits, pendingLines, fillRate: ordered > 0 ? Math.round((fulfilled / ordered) * 100) : 100 };
}

/** Which orders survive the year-end scrub: keep anything not fully fulfilled / cancelled. */
export function ordersToKeepOnScrub(orders: Order[]): Order[] {
  return orders.filter((o) => {
    const st = orderStatus(o);
    return st === 'open' || st === 'partial';
  });
}
