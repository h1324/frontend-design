import { describe, it, expect } from "vitest";
import {
  buildSalesVoucherXml,
  parseReceiptVoucher,
  paiseToRupees,
  rupeesToPaise,
} from "../lib/tally/tally-sync.js";

describe("tally sync (pure)", () => {
  it("converts paise ↔ rupees losslessly", () => {
    expect(paiseToRupees(590000n)).toBe("5900.00");
    expect(paiseToRupees(118050n)).toBe("1180.50");
    expect(rupeesToPaise("5900.00")).toBe(590000n);
    expect(rupeesToPaise("1,180.50")).toBe(118050n);
    expect(rupeesToPaise("1180.5")).toBe(118050n);
  });

  it("builds a well-formed, escaped Tally sales voucher", () => {
    const xml = buildSalesVoucherXml(
      {
        docNo: "INV/2026-27/000001",
        invoiceDate: new Date("2026-08-14T00:00:00Z"),
        taxableValuePaise: 500000n,
        cgstPaise: 45000n,
        sgstPaise: 45000n,
        igstPaise: 0n,
        totalPaise: 590000n,
      },
      "Acme & Sons",
    );
    expect(xml).toContain("<VOUCHERNUMBER>INV/2026-27/000001</VOUCHERNUMBER>");
    expect(xml).toContain("<PARTYLEDGERNAME>Acme &amp; Sons</PARTYLEDGERNAME>"); // escaped
    expect(xml).toContain("<DATE>20260814</DATE>");
    expect(xml).toContain("-5900.00"); // party debit = total
    expect(xml).toContain("<LEDGERNAME>CGST</LEDGERNAME>");
    expect(xml).not.toContain("<LEDGERNAME>IGST</LEDGERNAME>"); // zero → omitted
    // balanced tags
    expect((xml.match(/<VOUCHER /g) ?? []).length).toBe(1);
    expect((xml.match(/<\/VOUCHER>/g) ?? []).length).toBe(1);
  });

  it("parses a Tally receipt voucher into a normalised inbound receipt", () => {
    const xml =
      `<VOUCHER><VOUCHERGUID>abc-123</VOUCHERGUID><DATE>20260810</DATE>` +
      `<PARTYLEDGERNAME>Acme &amp; Sons</PARTYLEDGERNAME><AMOUNT>-1180.50</AMOUNT>` +
      `<REFERENCE>UPI-9988</REFERENCE></VOUCHER>`;
    const r = parseReceiptVoucher(xml);
    expect(r.externalRef).toBe("abc-123");
    expect(r.ledgerName).toBe("Acme &amp; Sons");
    expect(r.amountPaise).toBe(118050n);
    expect(r.reference).toBe("UPI-9988");
    expect(r.receivedAt.toISOString().slice(0, 10)).toBe("2026-08-10");
  });
});
