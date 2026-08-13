import { describe, it, expect } from "vitest";
import {
  apportion,
  movingAverage,
  reverseMovingAverage,
  landedUnitCost,
} from "../lib/landed-cost.js";

describe("landed cost (pure)", () => {
  it("apportions proportionally and sums to the exact total", () => {
    // weights 1:1:2 of 1000 → 250/250/500
    expect(apportion(["1", "1", "2"], 1000n)).toEqual([250n, 250n, 500n]);
  });

  it("hands the rounding remainder to the largest-weight line", () => {
    // 100 over weights 1:1:1 → 33/33/33 = 99, remainder 1 → largest (first on tie) gets it
    const shares = apportion(["1", "1", "1"], 100n);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(shares).toEqual([34n, 33n, 33n]);
    // uneven weights: remainder to the biggest
    const s2 = apportion(["1", "5", "1"], 100n);
    expect(s2.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(s2[1]).toBeGreaterThan(s2[0]!);
  });

  it("splits equally when weights are all zero/absent", () => {
    expect(apportion(["0", "0", "0"], 90n)).toEqual([30n, 30n, 30n]);
  });

  it("zero total apportions to nothing", () => {
    expect(apportion(["1", "2"], 0n)).toEqual([0n, 0n]);
  });

  it("moving average blends on-hand and incoming at cost", () => {
    // 100kg @ ₹50 (5000p) + 100kg @ ₹60 (6000p) → 5500p
    expect(movingAverage("100", 5000n, "100", 6000n)).toBe(5500n);
    // first receipt onto empty stock = the incoming cost
    expect(movingAverage("0", 0n, "200", 4200n)).toBe(4200n);
  });

  it("reverse moving average unwinds the most recent receipt exactly", () => {
    const avg = movingAverage("100", 5000n, "100", 6000n); // 5500
    expect(reverseMovingAverage("200", avg, "100", 6000n)).toBe(5000n);
    // removing everything → 0
    expect(reverseMovingAverage("100", 5000n, "100", 5000n)).toBe(0n);
  });

  it("landed unit cost = rate + apportioned charge per unit", () => {
    // rate 5000p, 500p of charge over 100 units → +5p/unit = 5005
    expect(landedUnitCost(5000n, 500n, "100")).toBe(5005n);
    // zero qty guards to the bare rate
    expect(landedUnitCost(5000n, 500n, "0")).toBe(5000n);
  });
});
