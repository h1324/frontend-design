import { describe, it, expect } from "vitest";
import {
  selectRate,
  selectValueDiscount,
  quoteMargin,
  discountedRatePaise,
  isBelowMarginFloor,
  type RateCandidate,
  type DiscountCandidate,
} from "../lib/pricing.js";

describe("pricing — rate selection (pure)", () => {
  const candidates: RateCandidate[] = [
    { source: "LIST", minQty: "0", ratePaise: 10000n, gstRatePct: "18" },
    { source: "TIER", minQty: "0", ratePaise: 9500n, gstRatePct: "18" },
    { source: "TIER", minQty: "1000", ratePaise: 9000n, gstRatePct: "18" },
    { source: "CUSTOMER", minQty: "0", ratePaise: 9200n, gstRatePct: "18" },
    { source: "CUSTOMER", minQty: "500", ratePaise: 8800n, gstRatePct: "18" },
  ];

  it("prefers the most specific source that has any qualifying band", () => {
    // qty 100: customer has a 0-band → customer wins over tier/list
    expect(selectRate(candidates, "100")).toEqual({
      source: "CUSTOMER",
      ratePaise: 9200n,
      gstRatePct: "18",
    });
  });

  it("within a source, picks the highest minQty band the qty clears", () => {
    // qty 600: customer 500-band clears → 8800
    expect(selectRate(candidates, "600")?.ratePaise).toBe(8800n);
    // qty 499: only customer 0-band clears → 9200
    expect(selectRate(candidates, "499")?.ratePaise).toBe(9200n);
  });

  it("falls back to tier, then list, when no more-specific source qualifies", () => {
    const tierAndList = candidates.filter((c) => c.source !== "CUSTOMER");
    expect(selectRate(tierAndList, "50")?.source).toBe("TIER");
    expect(selectRate(tierAndList, "1500")?.ratePaise).toBe(9000n); // tier 1000-band
    const listOnly = candidates.filter((c) => c.source === "LIST");
    expect(selectRate(listOnly, "50")?.source).toBe("LIST");
  });

  it("returns null when no band qualifies", () => {
    const highBandOnly: RateCandidate[] = [
      { source: "CUSTOMER", minQty: "1000", ratePaise: 8000n, gstRatePct: "18" },
    ];
    expect(selectRate(highBandOnly, "100")).toBeNull();
    expect(selectRate([], "100")).toBeNull();
  });
});

describe("pricing — value-discount selection (pure)", () => {
  const tiers: DiscountCandidate[] = [
    { source: "TIER", minOrderValuePaise: 50_000_00n, discountPct: "2" },
    { source: "TIER", minOrderValuePaise: 100_000_00n, discountPct: "3" },
    { source: "CUSTOMER", minOrderValuePaise: 200_000_00n, discountPct: "5" },
  ];

  it("takes the highest threshold cleared within the most specific source present", () => {
    // ₹1.5L: no customer tier clears (needs 2L), tier clears 1L → 3%
    expect(selectValueDiscount(tiers, 150_000_00n)).toEqual({
      source: "TIER",
      discountPct: "3",
    });
    // ₹2.5L: customer 2L clears → 5% (customer beats tier even though tier also clears)
    expect(selectValueDiscount(tiers, 250_000_00n)).toEqual({
      source: "CUSTOMER",
      discountPct: "5",
    });
  });

  it("returns null when nothing clears", () => {
    expect(selectValueDiscount(tiers, 10_000_00n)).toBeNull();
    expect(selectValueDiscount([], 10_000_00n)).toBeNull();
  });
});

describe("pricing — margin & discount arithmetic (pure)", () => {
  it("computes margin paise and % of sale", () => {
    expect(quoteMargin(10000n, 8000n)).toEqual({ marginPaise: 2000n, marginPct: "20" });
    expect(quoteMargin(10000n, 10000n).marginPct).toBe("0");
  });

  it("returns a null % when the rate is zero (undefined margin)", () => {
    expect(quoteMargin(0n, 500n)).toEqual({ marginPaise: -500n, marginPct: null });
  });

  it("applies a whole-order discount to a rate, half-up", () => {
    expect(discountedRatePaise(10000n, "10")).toBe(9000n);
    expect(discountedRatePaise(9999n, "2.5")).toBe(9749n); // 9749.025 → 9749
  });

  it("flags below-floor only when the cost is known, measured after the discount", () => {
    // cost unknown (0) → never below floor
    expect(isBelowMarginFloor(10000n, 0n, "0", "10")).toBe(false);
    // rate 10000, cost 9200 → 8% margin < 10% floor
    expect(isBelowMarginFloor(10000n, 9200n, "0", "10")).toBe(true);
    // rate 10000, cost 8000 → 20% margin ≥ 10% floor
    expect(isBelowMarginFloor(10000n, 8000n, "0", "10")).toBe(false);
    // a 15% order discount on the same line pushes net rate to 8500 → margin ~5.9% < floor
    expect(isBelowMarginFloor(10000n, 8000n, "15", "10")).toBe(true);
  });
});
