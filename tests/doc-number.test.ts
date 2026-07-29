import { describe, it, expect } from "vitest";
import { financialYear } from "../lib/financial-year.js";
import { formatDocNumber } from "../lib/doc-number.js";

describe("financialYear (India, April–March, IST boundary)", () => {
  it("mid-year dates land in the right FY", () => {
    expect(financialYear(new Date("2026-05-15T00:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2026-01-10T00:00:00Z"))).toBe("2025-26");
    expect(financialYear(new Date("2026-12-31T00:00:00Z"))).toBe("2026-27");
  });

  it("classifies the 1 April IST boundary by IST, not UTC", () => {
    // 2026-03-31T18:30:00Z == 2026-04-01 00:00 IST → new FY
    expect(financialYear(new Date("2026-03-31T18:30:00Z"))).toBe("2026-27");
    // one minute earlier is still 2026-03-31 in IST → old FY
    expect(financialYear(new Date("2026-03-31T18:29:00Z"))).toBe("2025-26");
  });

  it("formats the two-digit end year with a leading zero across centuries", () => {
    // FY starting 2099 → "2099-00"
    expect(financialYear(new Date("2099-06-01T00:00:00Z"))).toBe("2099-00");
  });
});

describe("formatDocNumber", () => {
  it("zero-pads the sequence to six digits", () => {
    expect(formatDocNumber("INV", "2026-27", 1)).toBe("INV/2026-27/000001");
    expect(formatDocNumber("DN", "2025-26", 123456)).toBe("DN/2025-26/123456");
  });
});
