import { describe, it, expect } from "vitest";
import {
  lineAmountPaise,
  poCommitmentPaise,
  lineBalance,
  isFullyReceived,
} from "../lib/purchasing.js";

describe("purchasing pure helpers", () => {
  it("lineAmountPaise = qty × rate, rounded to paise", () => {
    // 2000 kg × ₹85.00/kg (8500 paise) = ₹170,000 = 17,000,000 paise
    expect(lineAmountPaise("2000", 8500)).toBe(17_000_000);
    // fractional qty rounds half-up: 10.5 × 8501 = 89260.5 → 89261
    expect(lineAmountPaise("10.5", 8501)).toBe(89_261);
  });

  it("poCommitmentPaise sums line amounts", () => {
    const total = poCommitmentPaise([
      { qtyOrdered: "2000", ratePaise: 8500 }, // 17,000,000
      { qtyOrdered: "500", ratePaise: 12000 }, // 6,000,000
    ]);
    expect(total).toBe(23_000_000);
  });

  it("lineBalance = ordered − received (signed)", () => {
    expect(lineBalance("100", "40").toString()).toBe("60");
    expect(lineBalance("100", "100").toString()).toBe("0");
    expect(lineBalance("100", "120").toString()).toBe("-20"); // over-received
  });

  it("isFullyReceived is true only when every line's balance ≤ 0", () => {
    expect(
      isFullyReceived([
        { qtyOrdered: "100", qtyReceived: "100" },
        { qtyOrdered: "50", qtyReceived: "60" },
      ]),
    ).toBe(true);
    expect(
      isFullyReceived([
        { qtyOrdered: "100", qtyReceived: "100" },
        { qtyOrdered: "50", qtyReceived: "10" },
      ]),
    ).toBe(false);
  });
});
