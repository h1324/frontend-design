import { describe, it, expect } from "vitest";
import { isValidGstinFormat, gstinStateCode } from "../lib/gstin.js";
import {
  validateSupplierInput,
  SUPPLIER_SEED,
  type SupplierInput,
} from "../lib/suppliers.js";

describe("GSTIN format", () => {
  it("accepts a well-formed GSTIN", () => {
    expect(isValidGstinFormat("27ABCDE1234F1Z5")).toBe(true);
    expect(gstinStateCode("27ABCDE1234F1Z5")).toBe("27");
  });

  it("rejects malformed GSTINs", () => {
    expect(isValidGstinFormat("27ABCDE1234F1Z")).toBe(false); // 14 chars
    expect(isValidGstinFormat("270BCDE1234F1Z5")).toBe(false); // digit where a letter must be
    expect(isValidGstinFormat("27abcde1234f1z5")).toBe(false); // lowercase
    expect(isValidGstinFormat("")).toBe(false);
    expect(gstinStateCode("not-a-gstin")).toBeNull();
  });
});

describe("validateSupplierInput", () => {
  const base: SupplierInput = { code: "SUP-1", name: "A supplier" };

  it("accepts a supplier with no GSTIN (unregistered)", () => {
    expect(validateSupplierInput(base)).toEqual([]);
    expect(validateSupplierInput({ ...base, gstin: null })).toEqual([]);
  });

  it("accepts a valid GSTIN, rejects a malformed one", () => {
    expect(validateSupplierInput({ ...base, gstin: "27ABCDE1234F1Z5" })).toEqual([]);
    expect(validateSupplierInput({ ...base, gstin: "BADGSTIN" })).toContain(
      "gstin must be a valid 15-character GSTIN",
    );
  });

  it("requires code and name", () => {
    expect(validateSupplierInput({ code: "", name: "" })).toEqual(
      expect.arrayContaining(["code is required", "name is required"]),
    );
  });
});

describe("supplier seed", () => {
  it("every placeholder supplier validates and covers the material categories", () => {
    for (const s of SUPPLIER_SEED) expect(validateSupplierInput(s), s.code).toEqual([]);
    const tags = SUPPLIER_SEED.flatMap((s) => s.supplies ?? []);
    for (const t of ["LDPE", "BUTANE", "TALC", "GMS", "MASTERBATCH", "PACKING"]) {
      expect(tags).toContain(t);
    }
  });
});
