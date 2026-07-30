import { describe, it, expect } from "vitest";
import {
  validateCustomerInput,
  validateShipTo,
  CUSTOMER_SEED,
  type CustomerInput,
} from "../lib/customers.js";

const base: CustomerInput = { code: "CUST-1", name: "A customer" };

describe("validateCustomerInput", () => {
  it("accepts a minimal customer with no GSTIN", () => {
    expect(validateCustomerInput(base)).toEqual([]);
    expect(validateCustomerInput({ ...base, gstin: null })).toEqual([]);
  });

  it("validates GSTIN format when present", () => {
    expect(validateCustomerInput({ ...base, gstin: "27AABCU9603R1ZM" })).toEqual([]);
    expect(validateCustomerInput({ ...base, gstin: "bad" })).toContain(
      "gstin must be a valid 15-character GSTIN",
    );
  });

  it("rejects negative credit limit and non-integer credit days", () => {
    expect(validateCustomerInput({ ...base, creditLimit: "-1" })).toContain(
      "creditLimit must be ≥ 0",
    );
    expect(validateCustomerInput({ ...base, creditDays: 1.5 })).toContain(
      "creditDays must be a whole number ≥ 0",
    );
  });

  it("requires a 2-digit gstStateCode on each ship-to", () => {
    const errors = validateCustomerInput({
      ...base,
      shipTos: [{ label: "X", gstStateCode: "279" }],
    });
    expect(errors).toContain("shipTos[0]: gstStateCode must be a 2-digit state code");
  });

  it("rejects more than one default ship-to", () => {
    const errors = validateCustomerInput({
      ...base,
      shipTos: [
        { label: "A", gstStateCode: "27", isDefault: true },
        { label: "B", gstStateCode: "24", isDefault: true },
      ],
    });
    expect(errors).toContain("only one ship-to can be the default");
  });
});

describe("validateShipTo", () => {
  it("requires a label and a 2-digit code", () => {
    expect(validateShipTo({ label: "", gstStateCode: "27" })).toContain(
      "shipTo: label is required",
    );
    expect(validateShipTo({ label: "Main", gstStateCode: "ZZ" })).toContain(
      "shipTo: gstStateCode must be a 2-digit state code",
    );
    expect(validateShipTo({ label: "Main", gstStateCode: "27" })).toEqual([]);
  });
});

describe("customer seed", () => {
  it("every placeholder customer validates", () => {
    for (const c of CUSTOMER_SEED) expect(validateCustomerInput(c), c.code).toEqual([]);
  });

  it("includes a customer with ship-tos in two different states (IGST path)", () => {
    const multi = CUSTOMER_SEED.find((c) => (c.shipTos?.length ?? 0) >= 2);
    expect(multi).toBeDefined();
    const codes = new Set(multi?.shipTos?.map((s) => s.gstStateCode));
    expect(codes.size).toBeGreaterThanOrEqual(2);
  });
});
