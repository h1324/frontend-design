import { describe, it, expect } from "vitest";
import { applyRate, costPerUnit, allocateToRolls, lotTotalCost } from "../lib/costing.js";

describe("costing (pure)", () => {
  it("applies a rate against its basis driver", () => {
    const d = { outputKg: "1000", energyKwh: "250", hours: "8", rollCount: 20 };
    expect(applyRate(300n, "PER_KG", d)).toBe(300000n); // 1000kg × ₹3
    expect(applyRate(1200n, "PER_KWH", d)).toBe(300000n); // 250kWh × ₹12
    expect(applyRate(50000n, "PER_HOUR", d)).toBe(400000n); // 8h × ₹500
    expect(applyRate(2500n, "PER_ROLL", d)).toBe(50000n); // 20 rolls × ₹25
    expect(applyRate(1000n, "PER_KWH", { ...d, energyKwh: null })).toBe(0n); // no kWh → 0
  });

  it("cost per unit divides total by quantity, guarding zero", () => {
    expect(costPerUnit(1000000n, "1000")).toBe(1000n); // ₹10,000 over 1000kg → ₹10/kg
    expect(costPerUnit(1000000n, "0")).toBe(0n);
  });

  it("sums lot components into the total (regrind included, not written off)", () => {
    expect(
      lotTotalCost({
        rmCostPaise: 500000n,
        regrindCreditPaise: 50000n,
        energyCostPaise: 30000n,
        labourCostPaise: 20000n,
        overheadCostPaise: 10000n,
      }),
    ).toBe(610000n);
  });

  it("allocates cost to rolls by weight, summing back to the total exactly", () => {
    const shares = allocateToRolls(["46", "46", "45.8"], 610000n);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(610000n);
    // heavier rolls carry proportionally more
    expect(shares[0]).toBeGreaterThanOrEqual(shares[2]!);
  });
});
