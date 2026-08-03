import { describe, it, expect } from "vitest";
import { agingCountdown } from "../lib/aging.js";

const asOf = new Date("2026-08-03T06:00:00.000Z"); // 11:30 IST, 3 Aug

describe("agingCountdown (pure)", () => {
  it("reports ready once the ready date has passed", () => {
    const c = agingCountdown(new Date("2026-08-01T06:00:00.000Z"), asOf);
    expect(c.ready).toBe(true);
    expect(c.label).toBe("ready");
  });

  it("a null ready date means immediately available", () => {
    const c = agingCountdown(null, asOf);
    expect(c.ready).toBe(true);
    expect(c.label).toBe("ready (no aging)");
  });

  it("counts whole IST days until ready", () => {
    // ready 6 Aug 04:00Z (09:30 IST) — 3 IST days after 3 Aug
    const c = agingCountdown(new Date("2026-08-06T04:00:00.000Z"), asOf);
    expect(c.ready).toBe(false);
    expect(c.daysRemaining).toBe(3);
    expect(c.label).toBe("ready in 3 days");
  });

  it("labels tomorrow and a not-yet-passed same-instant-day as today", () => {
    expect(agingCountdown(new Date("2026-08-04T04:00:00.000Z"), asOf).label).toBe(
      "ready tomorrow",
    );
    // Later on the same IST day but not yet passed → "ready today"
    const c = agingCountdown(new Date("2026-08-03T18:00:00.000Z"), asOf);
    expect(c.ready).toBe(false);
    expect(c.label).toBe("ready today");
  });

  it("uses the IST day boundary: 22:00Z is already the next IST day", () => {
    // 2026-08-03T22:00Z = 03:30 IST on 4 Aug; ready 3 Aug 20:00Z = 01:30 IST 4 Aug (passed)
    const lateAsOf = new Date("2026-08-03T22:00:00.000Z");
    const c = agingCountdown(new Date("2026-08-03T20:00:00.000Z"), lateAsOf);
    expect(c.ready).toBe(true);
  });
});
