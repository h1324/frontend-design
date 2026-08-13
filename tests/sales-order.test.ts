import { describe, it, expect } from "vitest";
import {
  salesOrderTotalsPaise,
  isCreditBlocked,
  creditExposurePaise,
  lineRemaining,
} from "../lib/sales-order.js";

describe("sales order pure helpers", () => {
  it("values lines with GST (intra vs inter give the same total)", () => {
    const lines = [
      { qtyOrdered: "100", ratePaise: 5000, gstRatePct: "18" }, // 100 * ₹50 = ₹5,000 taxable
    ];
    const intra = salesOrderTotalsPaise(lines, true);
    const inter = salesOrderTotalsPaise(lines, false);
    expect(intra.taxablePaise).toBe(500000); // 100 * 5000
    expect(intra.taxPaise).toBe(90000); // 18% of 5,00,000
    expect(intra.totalPaise).toBe(590000);
    expect(inter.totalPaise).toBe(intra.totalPaise);
  });

  it("exposure sums outstanding and order total in paise", () => {
    expect(creditExposurePaise(100000n, 590000).toString()).toBe("690000");
  });

  it("blocks when exposure exceeds the limit (limit is in rupees)", () => {
    // limit ₹5,000 = 5,00,000 paise; exposure 5,90,000 → blocked
    expect(isCreditBlocked(0, 590000, "5000")).toBe(true);
    // limit ₹6,000 = 6,00,000 paise; exposure 5,90,000 → ok
    expect(isCreditBlocked(0, 590000, "6000")).toBe(false);
  });

  it("zero/null credit limit = cash terms → any exposure blocks", () => {
    expect(isCreditBlocked(0, 1, "0")).toBe(true);
    expect(isCreditBlocked(0, 0, "0")).toBe(false); // nothing owed, nothing blocked
  });

  it("existing outstanding pushes an otherwise-ok order over the limit", () => {
    // order ₹5,000 alone is within ₹6,000, but ₹2,000 already outstanding tips it over
    expect(isCreditBlocked(200000, 590000, "6000")).toBe(true);
  });

  it("computes remaining quantity to fulfil", () => {
    expect(lineRemaining("100", "30").toString()).toBe("70");
    expect(lineRemaining("100", "100").toString()).toBe("0");
  });
});
