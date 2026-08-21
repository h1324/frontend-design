import { describe, it, expect } from "vitest";
import { computePriceDelta } from "../lib/mobile/mobile.js";

describe("mobile — price delta (pure)", () => {
  it("flags only the lines where the device price differs from the server price", () => {
    const delta = computePriceDelta([
      { itemId: "a", devicePricePaise: 9500n, serverPricePaise: 9200n }, // differs
      { itemId: "b", devicePricePaise: 8000n, serverPricePaise: 8000n }, // same
      { itemId: "c", devicePricePaise: null, serverPricePaise: 7000n }, // no device price
    ]);
    expect(delta).toEqual([
      { itemId: "a", devicePricePaise: "9500", serverPricePaise: "9200" },
    ]);
  });

  it("accepts numeric device prices and is empty when everything agrees", () => {
    expect(
      computePriceDelta([{ itemId: "a", devicePricePaise: 100, serverPricePaise: 100n }]),
    ).toEqual([]);
    expect(computePriceDelta([])).toEqual([]);
  });
});
