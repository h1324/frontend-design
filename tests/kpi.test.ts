import { describe, it, expect } from "vitest";
import {
  availability,
  performance,
  quality,
  oee,
  oeeFactors,
  weightVarianceStats,
  toCsv,
} from "../lib/kpi.js";

describe("kpi calculators (pure)", () => {
  it("availability = operating / planned", () => {
    expect(availability("480", "48")).toBeCloseTo(0.9, 5); // 480 planned, 48 down → 90%
    expect(availability("0", "0")).toBeNull();
  });

  it("performance = actual / (rated × hours), null without a rated capacity", () => {
    // 8h at 250 kg/hr = 2000 capacity; 1800 actual → 90%
    expect(performance("1800", "250", "8")).toBeCloseTo(0.9, 5);
    expect(performance("1800", null, "8")).toBeNull();
    expect(performance("5000", "250", "8")).toBe(1); // capped at 1
  });

  it("quality = good / total", () => {
    expect(quality("950", "1000")).toBeCloseTo(0.95, 5);
  });

  it("oee is the product, null if any factor is unknown", () => {
    expect(oee(0.9, 0.9, 0.95)).toBeCloseTo(0.7695, 5);
    expect(oee(0.9, null, 0.95)).toBeNull();
  });

  it("oeeFactors derives operating hours from planned − downtime", () => {
    // planned 480min, down 48min → operating 432min = 7.2h; rated 250 → capacity 1800; actual 1800 → perf 1.0
    const r = oeeFactors({
      plannedMin: "480",
      downtimeMin: "48",
      actualKg: "1800",
      ratedKgHr: "250",
      goodKg: "950",
      totalKg: "1000",
    });
    expect(r.availability).toBeCloseTo(0.9, 5);
    expect(r.performance).toBeCloseTo(1, 5);
    expect(r.quality).toBeCloseTo(0.95, 5);
    expect(r.oee).toBeCloseTo(0.855, 5);
  });

  it("weight-variance stats summarise the spread, skipping zero-theoretical rolls", () => {
    const s = weightVarianceStats([
      { theoreticalKg: "100", actualKg: "102" }, // +2%
      { theoreticalKg: "100", actualKg: "98" }, // −2%
      { theoreticalKg: "0", actualKg: "5" }, // skipped
    ]);
    expect(s.count).toBe(2);
    expect(s.meanPct).toBeCloseTo(0, 5);
    expect(s.minPct).toBeCloseTo(-2, 5);
    expect(s.maxPct).toBeCloseTo(2, 5);
  });

  it("toCsv quotes fields containing commas/quotes/newlines", () => {
    const csv = toCsv(
      ["a", "b"],
      [
        ["plain", 'has,"comma"'],
        [1, 2],
      ],
    );
    expect(csv).toBe('a,b\nplain,"has,""comma"""\n1,2');
  });
});
