import { describe, it, expect } from "vitest";
import { remainingToReceive, wouldOverReceive } from "../lib/goods-receipt.js";

describe("goods-receipt pure helpers", () => {
  it("remainingToReceive = ordered − already received", () => {
    expect(remainingToReceive("100", "40").toString()).toBe("60");
    expect(remainingToReceive("100", "100").toString()).toBe("0");
  });

  it("wouldOverReceive is true only past the ordered quantity", () => {
    expect(wouldOverReceive("100", "40", "60")).toBe(false); // exactly to ordered
    expect(wouldOverReceive("100", "40", "61")).toBe(true); // one over
    expect(wouldOverReceive("100", "0", "100")).toBe(false);
    expect(wouldOverReceive("100", "90", "20")).toBe(true);
  });
});
