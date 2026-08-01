import { describe, it, expect } from "vitest";
import {
  validateMachine,
  validateShift,
  validateOperator,
  validateDowntimeReason,
  MACHINE_SEED,
  SHIFT_SEED,
  DOWNTIME_REASON_SEED,
} from "../lib/production-masters.js";

describe("validateMachine", () => {
  it("requires code and name; capacity must be positive when present", () => {
    expect(validateMachine({ code: "M1", name: "Line" })).toEqual([]);
    expect(
      validateMachine({ code: "M1", name: "Line", ratedCapacityKgHr: "120" }),
    ).toEqual([]);
    expect(validateMachine({ code: "", name: "" })).toEqual(
      expect.arrayContaining(["code is required", "name is required"]),
    );
    expect(
      validateMachine({ code: "M1", name: "Line", ratedCapacityKgHr: "0" }),
    ).toContain("ratedCapacityKgHr must be greater than zero");
  });
});

describe("validateShift", () => {
  it("requires HH:MM times", () => {
    expect(
      validateShift({ code: "A", name: "A", startTime: "08:00", endTime: "16:00" }),
    ).toEqual([]);
    // overnight is allowed (end < start)
    expect(
      validateShift({ code: "C", name: "C", startTime: "00:00", endTime: "08:00" }),
    ).toEqual([]);
    expect(
      validateShift({ code: "A", name: "A", startTime: "8am", endTime: "16:00" }),
    ).toContain("startTime must be HH:MM");
    expect(
      validateShift({ code: "A", name: "A", startTime: "08:00", endTime: "24:00" }),
    ).toContain("endTime must be HH:MM");
  });
});

describe("validateOperator", () => {
  it("requires code and name", () => {
    expect(validateOperator({ code: "OP1", name: "X" })).toEqual([]);
    expect(validateOperator({ code: "", name: "" })).toHaveLength(2);
  });
});

describe("validateDowntimeReason", () => {
  it("requires a valid category", () => {
    expect(
      validateDowntimeReason({
        code: "DIE",
        description: "Die change",
        category: "DIE_CHANGE",
      }),
    ).toEqual([]);
    expect(
      // @ts-expect-error — invalid category
      validateDowntimeReason({ code: "X", description: "x", category: "NOPE" }),
    ).toContain("category is invalid");
  });
});

describe("seeds", () => {
  it("validate", () => {
    for (const m of MACHINE_SEED) expect(validateMachine(m)).toEqual([]);
    for (const s of SHIFT_SEED) expect(validateShift(s)).toEqual([]);
    for (const d of DOWNTIME_REASON_SEED) expect(validateDowntimeReason(d)).toEqual([]);
  });

  it("includes the FLY-250 line and three shifts", () => {
    expect(MACHINE_SEED.some((m) => m.code === "FLY-250")).toBe(true);
    expect(SHIFT_SEED.map((s) => s.code).sort()).toEqual(["A", "B", "C"]);
  });
});
