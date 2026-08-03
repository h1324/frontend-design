import { describe, it, expect } from "vitest";
import {
  computeRegrindPct,
  computeYieldPct,
  materialBalance,
  agingReadyDate,
} from "../lib/production.js";

describe("production metric helpers (pure)", () => {
  it("computeRegrindPct = regrind qty / total qty × 100", () => {
    const pct = computeRegrindPct([
      { qtyBase: "800", isRegrind: false }, // virgin resin
      { qtyBase: "200", isRegrind: true }, // regrind blend
    ]);
    expect(pct.toString()).toBe("20"); // 200 / 1000 × 100
  });

  it("computeRegrindPct is 0 for an empty or all-virgin set (no divide-by-zero)", () => {
    expect(computeRegrindPct([]).toString()).toBe("0");
    expect(computeRegrindPct([{ qtyBase: "500", isRegrind: false }]).toString()).toBe(
      "0",
    );
  });

  it("computeRegrindPct sums multiple regrind lines exactly", () => {
    const pct = computeRegrindPct([
      { qtyBase: "700", isRegrind: false },
      { qtyBase: "150", isRegrind: true },
      { qtyBase: "150", isRegrind: true },
    ]);
    expect(pct.toString()).toBe("30"); // 300 / 1000 × 100
  });

  it("computeYieldPct = output / input × 100; 0 input yields 0", () => {
    expect(computeYieldPct("1000", "920").toString()).toBe("92");
    expect(computeYieldPct("0", "50").toString()).toBe("0");
  });

  it("materialBalance = input − (output + scrap + trim), signed", () => {
    // input 1000, output 920, scrap 40, trim 30 → −(- ) variance of 10 unaccounted
    expect(materialBalance("1000", "920", "40", "30").toString()).toBe("10");
    // a perfectly reconciled batch balances to zero
    expect(materialBalance("1000", "900", "60", "40").toString()).toBe("0");
    // over-accounted (more out than in) goes negative, not clamped
    expect(materialBalance("1000", "980", "30", "10").toString()).toBe("-20");
  });

  it("agingReadyDate adds whole aging days to the production date", () => {
    const prod = new Date("2026-08-03T06:00:00.000Z");
    const ready = agingReadyDate(prod, 3);
    expect(ready.toISOString()).toBe("2026-08-06T06:00:00.000Z");
    // 0 aging days = ready immediately (already cured items)
    expect(agingReadyDate(prod, 0).toISOString()).toBe(prod.toISOString());
  });
});
