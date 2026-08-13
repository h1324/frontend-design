import { describe, it, expect } from "vitest";
import { densityVariance, withinDensityTolerance, validSplit } from "../lib/qc.js";

describe("qc pure helpers", () => {
  it("densityVariance = measured − target (signed)", () => {
    expect(densityVariance("25.4", "25").toString()).toBe("0.4");
    expect(densityVariance("23", "25").toString()).toBe("-2");
  });

  it("withinDensityTolerance checks |measured − target| ≤ tolerance", () => {
    expect(withinDensityTolerance("25.4", "25", "0.5")).toBe(true);
    expect(withinDensityTolerance("25.6", "25", "0.5")).toBe(false);
    expect(withinDensityTolerance("24.5", "25", "0.5")).toBe(true); // exactly on the band edge
    expect(withinDensityTolerance("22", "25", "2")).toBe(false);
  });

  it("validSplit enforces passed+failed=received and result semantics", () => {
    expect(validSplit("100", "100", "0", "PASS")).toBe(true);
    expect(validSplit("100", "0", "100", "FAIL")).toBe(true);
    expect(validSplit("100", "60", "40", "PARTIAL")).toBe(true);
    // wrong totals or wrong result kind
    expect(validSplit("100", "60", "50", "PARTIAL")).toBe(false); // 60+50 ≠ 100
    expect(validSplit("100", "100", "0", "PARTIAL")).toBe(false); // partial needs both sides
    expect(validSplit("100", "60", "40", "PASS")).toBe(false); // pass must be full
    expect(validSplit("100", "-10", "110", "PARTIAL")).toBe(false); // negative
  });
});
