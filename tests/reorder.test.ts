import { describe, it, expect } from "vitest";
import {
  forecastDailyDemand,
  reorderPoint,
  suggestedQty,
  daysOfCover,
  safetyStockFromDaysOfCover,
  ReorderError,
} from "../lib/reorder.js";
import { Decimal } from "../lib/decimal.js";

describe("reorder — forecast (pure)", () => {
  it("moving average = total consumed ÷ window", () => {
    // 900 kg over 90 days → 10 kg/day
    expect(forecastDailyDemand({ totalConsumed: "900", windowDays: 90 }).toString()).toBe(
      "10",
    );
  });

  it("is robust to zero-consumption gaps — quiet days pull the average down", () => {
    // Same 900 kg consumed, but measured over a 180-day window → 5 kg/day.
    expect(
      forecastDailyDemand({ totalConsumed: "900", windowDays: 180 }).toString(),
    ).toBe("5");
  });

  it("zero consumption over the window is zero demand, not a divide error", () => {
    expect(forecastDailyDemand({ totalConsumed: "0", windowDays: 90 }).toString()).toBe(
      "0",
    );
  });

  it("rejects a non-positive window", () => {
    expect(() => forecastDailyDemand({ totalConsumed: "10", windowDays: 0 })).toThrow(
      ReorderError,
    );
    expect(() => forecastDailyDemand({ totalConsumed: "10", windowDays: -5 })).toThrow(
      ReorderError,
    );
  });

  it("rejects negative consumption", () => {
    expect(() => forecastDailyDemand({ totalConsumed: "-1", windowDays: 90 })).toThrow(
      ReorderError,
    );
  });
});

describe("reorder — reorder point (pure)", () => {
  it("= avgDaily × leadTime + safety stock", () => {
    // 10 kg/day, 7-day lead, 50 kg safety → 120 kg
    expect(reorderPoint("10", 7, "50").toString()).toBe("120");
  });

  it("defaults safety stock to zero", () => {
    expect(reorderPoint("10", 7).toString()).toBe("70");
  });

  it("a zero lead time reduces the point to just safety stock", () => {
    expect(reorderPoint("10", 0, "50").toString()).toBe("50");
  });

  it("rejects a negative lead time", () => {
    expect(() => reorderPoint("10", -1)).toThrow(ReorderError);
  });
});

describe("reorder — suggested quantity (pure)", () => {
  const base = {
    reorderPoint: "120",
    avgDailyConsumption: "10",
    leadTimeDays: 7,
  };

  it("buys back to reorder point + one lead-time of cover, less on-hand", () => {
    // target = 120 + 10×7 = 190; on-hand 40 → suggest 150
    expect(suggestedQty({ ...base, onHand: "40" }).toString()).toBe("150");
  });

  it("never suggests a negative quantity when comfortably stocked", () => {
    expect(suggestedQty({ ...base, onHand: "500" }).toString()).toBe("0");
  });

  it("returns zero exactly at the target", () => {
    expect(suggestedQty({ ...base, onHand: "190" }).toString()).toBe("0");
  });

  it("floors a positive suggestion up to the supplier MOQ", () => {
    // target 190, on-hand 185 → raw 5, MOQ 25 → 25
    expect(suggestedQty({ ...base, onHand: "185", moq: "25" }).toString()).toBe("25");
  });

  it("does not floor a suggestion already above the MOQ", () => {
    expect(suggestedQty({ ...base, onHand: "40", moq: "25" }).toString()).toBe("150");
  });

  it("ignores a zero/blank MOQ", () => {
    expect(suggestedQty({ ...base, onHand: "185", moq: "0" }).toString()).toBe("5");
    expect(suggestedQty({ ...base, onHand: "185", moq: "" }).toString()).toBe("5");
  });
});

describe("reorder — days of cover (pure)", () => {
  it("= on-hand ÷ avgDaily", () => {
    expect(daysOfCover("100", "10")?.toString()).toBe("10");
  });

  it("is null (infinite cover) when nothing is being consumed", () => {
    expect(daysOfCover("100", "0")).toBeNull();
  });

  it("safetyStockFromDaysOfCover = avgDaily × days", () => {
    expect(safetyStockFromDaysOfCover("10", 5).toString()).toBe("50");
    expect(() => safetyStockFromDaysOfCover("10", -1)).toThrow(ReorderError);
  });
});

describe("reorder — end-to-end pure chain", () => {
  it("butane: 90-day history → point → suggestion reconcile", () => {
    // 1800 kg over 90 days = 20 kg/day; 5-day lead, 100 kg safety → point 200.
    const avg = forecastDailyDemand({ totalConsumed: "1800", windowDays: 90 });
    expect(avg.toString()).toBe("20");
    const point = reorderPoint(avg, 5, "100");
    expect(point.toString()).toBe("200");
    // on-hand 60 (below point) → target 200 + 20×5 = 300; suggest 240.
    const sugg = suggestedQty({
      onHand: "60",
      reorderPoint: point,
      avgDailyConsumption: avg,
      leadTimeDays: 5,
    });
    expect(sugg.toString()).toBe("240");
    expect(new Decimal("60").lte(point)).toBe(true); // would trip a suggestion
  });
});
