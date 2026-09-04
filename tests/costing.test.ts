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

  it("adds regrind as a valued input (recovered RM), never a credit/write-off", () => {
    // rm 500000 + regrind 50000 + energy 30000 + labour 20000 + overhead 10000 = 610000.
    // Regrind is ADDED: a "credit" (subtract) would give 510000, which would be wrong.
    expect(
      lotTotalCost({
        rmCostPaise: 500000n,
        regrindCostPaise: 50000n,
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
