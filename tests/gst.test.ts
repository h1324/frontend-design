import { describe, it, expect } from "vitest";
import {
  isIntraState,
  lineTaxableValuePaise,
  computeLineTax,
  sumInvoiceTotals,
  formatPaise,
} from "../lib/gst.js";

describe("GST tax determination (pure)", () => {
  it("same state → intra-state (CGST+SGST); different → inter-state (IGST)", () => {
    expect(isIntraState("27", "27")).toBe(true); // both Maharashtra
    expect(isIntraState("27", "24")).toBe(false); // MH → Gujarat
    expect(isIntraState("", "27")).toBe(false); // unknown seller state
  });

  it("intra-state splits tax into equal CGST + SGST, no IGST", () => {
    // taxable ₹1000 = 100000 paise, 18% → ₹180 tax → CGST 90 + SGST 90
    const t = computeLineTax(100000, "18", true);
    expect(t).toEqual({ cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0 });
  });

  it("inter-state puts the whole tax in IGST", () => {
    const t = computeLineTax(100000, "18", false);
    expect(t).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 18000 });
  });

  it("rounds each tax component to the nearest paisa (half-up)", () => {
    // taxable 12345 paise, 18% = 2222.1 paise → IGST 2222
    expect(computeLineTax(12345, "18", false).igstPaise).toBe(2222);
    // intra: half = 1111.05 → 1111 each
    const t = computeLineTax(12345, "18", true);
    expect(t.cgstPaise).toBe(1111);
    expect(t.sgstPaise).toBe(1111);
  });

  it("line taxable value = qty × rate, rounded to paise", () => {
    // 120 m² × ₹42.50/m² (4250 paise) = ₹5100 = 510000 paise
    expect(lineTaxableValuePaise("120", 4250)).toBe(510000);
    // fractional m² rounds half-up: 120.5 × 4250 = 512125
    expect(lineTaxableValuePaise("120.5", 4250)).toBe(512125);
  });
});

describe("invoice totals (pure)", () => {
  it("sums lines, rounds total to the nearest rupee, discloses the round-off; taxable+tax=total", () => {
    // one line: taxable 510000, 18% intra → cgst 45900 sgst 45900
    const line = { taxableValuePaise: 510000, ...computeLineTax(510000, "18", true) };
    const totals = sumInvoiceTotals([line]);
    expect(totals.taxableValuePaise).toBe(510000);
    expect(totals.cgstPaise).toBe(45900);
    expect(totals.sgstPaise).toBe(45900);
    expect(totals.igstPaise).toBe(0);
    // pre-round = 601800 paise → nearest rupee = 601800 (already whole rupee) → roundOff 0
    expect(totals.roundOffPaise).toBe(0);
    expect(totals.totalPaise).toBe(601800);
    // reconciles
    expect(
      totals.taxableValuePaise + totals.cgstPaise + totals.sgstPaise + totals.igstPaise,
    ).toBe(totals.totalPaise - totals.roundOffPaise);
  });

  it("captures a non-zero round-off when the total has paise", () => {
    // taxable 10025 paise + igst @18% = 1804.5→1805 → pre-round 11830 → nearest rupee 11800
    const line = { taxableValuePaise: 10025, ...computeLineTax(10025, "18", false) };
    const totals = sumInvoiceTotals([line]);
    const preRound = 10025 + totals.igstPaise;
    expect(totals.totalPaise).toBe(Math.round(preRound / 100) * 100);
    expect(totals.totalPaise - totals.roundOffPaise).toBe(preRound);
    expect(Math.abs(totals.roundOffPaise)).toBeLessThanOrEqual(50);
  });
});

describe("formatPaise (Indian grouping)", () => {
  it("groups in lakh/crore with a rupee sign", () => {
    expect(formatPaise(601800)).toBe("₹6,018.00");
    expect(formatPaise(1234567890)).toBe("₹1,23,45,678.90"); // 12345678.90
    expect(formatPaise(-5000)).toBe("-₹50.00");
    expect(formatPaise(0)).toBe("₹0.00");
  });
});
