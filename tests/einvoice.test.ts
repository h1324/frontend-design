import { describe, it, expect } from "vitest";
import {
  isEInvoiceApplicable,
  isValidEInvoiceHsn,
  isEwayBillRequired,
  withinCancelWindow,
  buildIrpPayload,
  DEFAULT_THRESHOLDS,
} from "../lib/einvoice/einvoice.js";
import { MockProvider } from "../lib/einvoice/provider.js";
import { Decimal } from "../lib/decimal.js";

// A minimal invoice shape for the pure payload builder.
function invoice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    docNo: "INV/2026-27/000001",
    invoiceDate: new Date("2026-08-14T00:00:00Z"),
    placeOfSupplyStateCode: "27",
    taxableValuePaise: 500000n,
    totalPaise: 590000n,
    customer: { gstin: "27AAAAA0000A1Z5" },
    lines: [
      {
        itemId: "i1",
        description: "EPE Sheet",
        hsnCode: "3921",
        qtyKg: new Decimal("100"),
        qtyM2: new Decimal("400"),
        gstRatePct: new Decimal("18"),
        taxableValuePaise: 500000n,
      },
    ],
    ...overrides,
  } as never;
}

describe("e-invoice (pure)", () => {
  it("e-invoice applicability is turnover + B2B, never invoice value", () => {
    // Applicable only when the company is over the AATO threshold AND the buyer is B2B (has GSTIN).
    expect(isEInvoiceApplicable(true, "27AAAAA0000A1Z5")).toBe(true);
    expect(isEInvoiceApplicable(true, null)).toBe(false); // B2C — never e-invoiced
    expect(isEInvoiceApplicable(true, "")).toBe(false);
    expect(isEInvoiceApplicable(false, "27AAAAA0000A1Z5")).toBe(false); // below AATO threshold
  });

  it("e-invoice HSN must be 6 or 8 digits", () => {
    expect(isValidEInvoiceHsn("39211900")).toBe(true); // 8
    expect(isValidEInvoiceHsn("392119")).toBe(true); // 6
    expect(isValidEInvoiceHsn("3921")).toBe(false); // 4 — fine on the item master, not the IRP
    expect(isValidEInvoiceHsn(null)).toBe(false);
  });

  it("e-way bill is value-gated at ₹50,000", () => {
    expect(isEwayBillRequired(4_000_000n)).toBe(false);
    expect(isEwayBillRequired(5_000_000n)).toBe(true);
    expect(DEFAULT_THRESHOLDS.ewbMinPaise).toBe(5_000_000n);
  });

  it("cancel window closes after the configured hours", () => {
    const ack = new Date("2026-08-14T00:00:00Z");
    expect(withinCancelWindow(ack, new Date("2026-08-14T10:00:00Z"))).toBe(true);
    expect(withinCancelWindow(ack, new Date("2026-08-15T01:00:00Z"))).toBe(false); // >24h
    expect(withinCancelWindow(ack, new Date("2026-08-14T02:00:00Z"), 1)).toBe(false); // 1h window
  });

  it("builds a schema-shaped IRP payload from the invoice + seller GSTIN", () => {
    const p = buildIrpPayload(invoice(), "27BBBBB1111B1Z5");
    expect(p.docNo).toBe("INV/2026-27/000001");
    expect(p.sellerGstin).toBe("27BBBBB1111B1Z5");
    expect(p.buyerGstin).toBe("27AAAAA0000A1Z5");
    expect(p.placeOfSupply).toBe("27");
    expect(p.items).toHaveLength(1);
    expect(p.items[0]!.hsn).toBe("3921");
    expect(p.items[0]!.qty).toBe("400");
  });

  it("MockProvider is deterministic: same payload → same IRN", async () => {
    const p = new MockProvider();
    const payload = buildIrpPayload(invoice(), "27BBBBB1111B1Z5");
    const at = new Date("2026-08-14T05:00:00Z");
    const a = await p.generateIrn(payload, at);
    const b = await p.generateIrn(payload, at);
    expect(a.irn).toBe(b.irn);
    expect(a.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(a.ackDate).toBe(at);
    const ewb = await p.generateEwayBill(payload, 350, at);
    expect(ewb.ewbNo).toMatch(/^\d{12}$/);
    // 350km → 2-day slab
    expect(ewb.validTill.getTime()).toBe(at.getTime() + 2 * 86_400_000);
  });
});
