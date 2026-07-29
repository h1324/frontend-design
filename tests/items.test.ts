import { describe, it, expect } from "vitest";
import {
  validateItemInput,
  itemWarnings,
  resolveAgingDays,
  type ItemInput,
} from "../lib/items.js";
import { LAUNCH_CATALOGUE } from "../lib/catalogue.js";

const foamBase: ItemInput = {
  code: "FG-1",
  name: "Foam",
  type: "FINISHED_GOOD",
  uomBase: "M2",
  thickness_mm: "2",
  width_mm: "1200",
  density_kg_m3: "22",
  layerCount: 1,
};

describe("validateItemInput", () => {
  it("accepts a well-formed foam finished good", () => {
    expect(validateItemInput(foamBase)).toEqual([]);
  });

  it("requires foam attributes for FINISHED_GOOD / WIP_ROLL", () => {
    const errors = validateItemInput({
      code: "FG-2",
      name: "Foam",
      type: "FINISHED_GOOD",
      uomBase: "M2",
    });
    expect(errors).toContain("thickness_mm is required for foam items");
    expect(errors).toContain("width_mm is required for foam items");
    expect(errors).toContain("density_kg_m3 is required for foam items");
    expect(errors).toContain("layerCount is required for foam items");
  });

  it("does NOT require foam attributes for a raw material", () => {
    expect(
      validateItemInput({
        code: "RM-1",
        name: "LDPE",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      }),
    ).toEqual([]);
  });

  it("validates HSN format (2/4/6/8 digits) without hardcoding a value", () => {
    expect(validateItemInput({ ...foamBase, hsnCode: "3921" })).toEqual([]);
    expect(validateItemInput({ ...foamBase, hsnCode: "39211900" })).toEqual([]);
    expect(validateItemInput({ ...foamBase, hsnCode: "392" })).toContain(
      "hsnCode must be 2, 4, 6 or 8 digits",
    );
    expect(validateItemInput({ ...foamBase, hsnCode: "39A1" })).toContain(
      "hsnCode must be 2, 4, 6 or 8 digits",
    );
  });

  it("rejects non-positive dimensions and bad layer/aging counts", () => {
    expect(validateItemInput({ ...foamBase, thickness_mm: "0" })).toContain(
      "thickness_mm must be greater than zero",
    );
    expect(validateItemInput({ ...foamBase, layerCount: 0 })).toContain(
      "layerCount must be a whole number ≥ 1",
    );
    expect(validateItemInput({ ...foamBase, agingDays: -1 })).toContain(
      "agingDays must be a whole number ≥ 0",
    );
  });

  it("rejects an unknown uomBase", () => {
    expect(validateItemInput({ ...foamBase, uomBase: "TONNE" })).toContain(
      "uomBase must be one of KG, M2, NOS, LITRE",
    );
  });
});

describe("itemWarnings", () => {
  it("soft-warns on density outside 15–45 but does not error", () => {
    expect(itemWarnings({ ...foamBase, density_kg_m3: "22" })).toEqual([]);
    expect(itemWarnings({ ...foamBase, density_kg_m3: "60" })).toHaveLength(1);
    // still valid — a warning, not an error
    expect(validateItemInput({ ...foamBase, density_kg_m3: "60" })).toEqual([]);
  });
});

describe("resolveAgingDays", () => {
  it("uses the item override when set, else the plant default", () => {
    expect(resolveAgingDays(10, 7)).toBe(10);
    expect(resolveAgingDays(null, 7)).toBe(7);
    expect(resolveAgingDays(undefined, 5)).toBe(5);
  });
});

describe("launch catalogue", () => {
  it("every planned item passes validation", () => {
    for (const item of LAUNCH_CATALOGUE) {
      expect(validateItemInput(item), `invalid: ${item.code}`).toEqual([]);
    }
  });

  it("includes the mandated edge cases and input materials", () => {
    const codes = LAUNCH_CATALOGUE.map((i) => i.code);
    // 0.5 mm ultra-thin
    expect(LAUNCH_CATALOGUE.some((i) => i.thickness_mm === "0.5")).toBe(true);
    // 8-layer laminate
    expect(LAUNCH_CATALOGUE.some((i) => i.layerCount === 8)).toBe(true);
    // odd-width special
    expect(LAUNCH_CATALOGUE.some((i) => i.width_mm === "1350")).toBe(true);
    // raw materials
    expect(codes).toEqual(
      expect.arrayContaining([
        "RM-LDPE-FILM",
        "RM-BUTANE",
        "RM-TALC",
        "RM-GMS",
        "RM-MB-WHITE",
      ]),
    );
  });
});
