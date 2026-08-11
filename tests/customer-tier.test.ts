import { describe, it, expect } from "vitest";
import { tierScore, scoreTier, DEFAULT_TIER_CONFIG } from "../lib/customer-tier.js";

describe("customer tier scoring (pure)", () => {
  it("UNGRADED until enough history, regardless of score", () => {
    expect(
      scoreTier({
        rolling12mVolumeKg: "100000",
        onTimePaymentRatio: 1,
        monthsOfHistory: 2,
      }),
    ).toBe("UNGRADED");
  });

  it("high volume + on-time payment scores A", () => {
    expect(
      scoreTier({
        rolling12mVolumeKg: "60000",
        onTimePaymentRatio: 1,
        monthsOfHistory: 12,
      }),
    ).toBe("A");
  });

  it("mid volume with neutral (unknown) payment scores B", () => {
    // volume 25000/50000 = 0.5 → 0.5*0.5 + 0.5*0.5(neutral) = 0.5 → B band [0.33,0.66)
    expect(
      scoreTier({
        rolling12mVolumeKg: "25000",
        onTimePaymentRatio: null,
        monthsOfHistory: 12,
      }),
    ).toBe("B");
  });

  it("low volume + poor payment scores C", () => {
    expect(
      scoreTier({
        rolling12mVolumeKg: "1000",
        onTimePaymentRatio: 0,
        monthsOfHistory: 12,
      }),
    ).toBe("C");
  });

  it("volume score is capped at the full-score threshold", () => {
    const capped = tierScore({
      rolling12mVolumeKg: "999999",
      onTimePaymentRatio: 1,
      monthsOfHistory: 12,
    });
    expect(capped).toBe(1); // 0.5*1(capped) + 0.5*1
  });

  it("is deterministic for the same inputs", () => {
    const inputs = {
      rolling12mVolumeKg: "30000",
      onTimePaymentRatio: 0.7,
      monthsOfHistory: 8,
    };
    expect(tierScore(inputs)).toBe(tierScore(inputs));
    expect(DEFAULT_TIER_CONFIG.minMonths).toBe(3);
  });
});
