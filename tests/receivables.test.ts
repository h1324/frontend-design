import { describe, it, expect } from "vitest";
import {
  daysOverdue,
  ageingBucketKey,
  bucketReceivables,
  wouldOverAllocateReceipt,
  wouldOverSettleInvoice,
} from "../lib/receivables.js";

const day = 86_400_000;
// A fixed "today" at IST midday to keep bucket maths unambiguous.
const asOf = new Date("2026-08-11T06:30:00Z"); // 12:00 IST

function daysAgo(n: number): Date {
  return new Date(asOf.getTime() - n * day);
}
function daysAhead(n: number): Date {
  return new Date(asOf.getTime() + n * day);
}

describe("receivables ageing (pure)", () => {
  it("daysOverdue is by IST calendar day", () => {
    expect(daysOverdue(daysAgo(0), asOf)).toBe(0);
    expect(daysOverdue(daysAgo(45), asOf)).toBe(45);
    expect(daysOverdue(daysAhead(10), asOf)).toBe(-10);
  });

  it("buckets by due date against the boundaries", () => {
    expect(ageingBucketKey(daysAhead(5), asOf)).toBe("current"); // not yet due
    expect(ageingBucketKey(daysAgo(0), asOf)).toBe("current"); // due today
    expect(ageingBucketKey(daysAgo(1), asOf)).toBe("d0_30");
    expect(ageingBucketKey(daysAgo(30), asOf)).toBe("d0_30");
    expect(ageingBucketKey(daysAgo(31), asOf)).toBe("d31_60");
    expect(ageingBucketKey(daysAgo(60), asOf)).toBe("d31_60");
    expect(ageingBucketKey(daysAgo(61), asOf)).toBe("d61_90");
    expect(ageingBucketKey(daysAgo(90), asOf)).toBe("d61_90");
    expect(ageingBucketKey(daysAgo(91), asOf)).toBe("d90plus");
    expect(ageingBucketKey(daysAgo(365), asOf)).toBe("d90plus");
  });

  it("sums unsettled balances into buckets, skipping non-positive", () => {
    const totals = bucketReceivables(
      [
        { remainingPaise: 100000n, dueDate: daysAhead(5) }, // current
        { remainingPaise: 50000n, dueDate: daysAgo(10) }, // 0-30
        { remainingPaise: 25000n, dueDate: daysAgo(45) }, // 31-60
        { remainingPaise: 10000n, dueDate: daysAgo(120) }, // 90+
        { remainingPaise: 0n, dueDate: daysAgo(200) }, // skipped (settled)
        { remainingPaise: -5000n, dueDate: daysAgo(5) }, // skipped (credit)
      ],
      asOf,
    );
    expect(totals.current).toBe(100000n);
    expect(totals.d0_30).toBe(50000n);
    expect(totals.d31_60).toBe(25000n);
    expect(totals.d61_90).toBe(0n);
    expect(totals.d90plus).toBe(10000n);
    expect(totals.total).toBe(185000n);
  });

  it("guards over-allocation and over-settlement", () => {
    // receipt of 1000; 600 already allocated; another 500 → 1100 > 1000 → blocked
    expect(wouldOverAllocateReceipt(1000n, 600n, 500n)).toBe(true);
    expect(wouldOverAllocateReceipt(1000n, 600n, 400n)).toBe(false);
    // invoice total 1000; 900 settled; +200 → 1100 > 1000 → blocked
    expect(wouldOverSettleInvoice(1000n, 900n, 200n)).toBe(true);
    expect(wouldOverSettleInvoice(1000n, 900n, 100n)).toBe(false);
  });
});
