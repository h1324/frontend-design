import { describe, it, expect } from "vitest";
import { childReCures, childInitialState } from "../lib/converting.js";

describe("converting operation rules (pure)", () => {
  it("lamination re-cures; slitting and bag-making do not", () => {
    expect(childReCures("LAMINATION")).toBe(true);
    expect(childReCures("SLITTING")).toBe(false);
    expect(childReCures("BAG_MAKING")).toBe(false);
  });

  it("child initial state: CURING for laminate, AVAILABLE for slit/bag", () => {
    expect(childInitialState("LAMINATION")).toBe("CURING");
    expect(childInitialState("SLITTING")).toBe("AVAILABLE");
    expect(childInitialState("BAG_MAKING")).toBe("AVAILABLE");
  });
});
