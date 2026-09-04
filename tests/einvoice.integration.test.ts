import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  generateIrn,
  generateEwayBill,
  cancelIrn,
  EInvoiceError,
} from "../lib/einvoice/einvoice.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("e-invoice (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let dispatch: Actor;
  let sales: Actor;
  let itemId: string;
  let customerId: string;
  let shipToId: string;
  let seq = 0;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      // Turnover over the AATO threshold → e-invoicing applies (to B2B invoices).
      data: {
        name: `EI Co ${Date.now()}`,
        gstin: "27AABCE1234F1Z5",
        einvoiceApplicable: true,
      },
    });
    companyId = company.id;
    const dp = await prisma.user.create({
      data: {
        companyId,
        email: `ei-dp-${Date.now()}@t.local`,
        name: "Dp",
        passwordHash: "x",
        role: "DISPATCH",
      },
    });
    const sa = await prisma.user.create({
      data: {
        companyId,
        email: `ei-sa-${Date.now()}@t.local`,
        name: "Sa",
        passwordHash: "x",
        role: "SALES",
      },
    });
    dispatch = { userId: dp.id, companyId, role: "DISPATCH" };
    sales = { userId: sa.id, companyId, role: "SALES" };
    itemId = (
      await prisma.item.create({
        data: {
          companyId,
          code: `FG-${Date.now()}`,
          name: "EPE",
          type: "FINISHED_GOOD",
          uomBase: "M2",
        },
      })
    ).id;
    const customer = await prisma.customer.create({
      data: {
        companyId,
        code: `C-${Date.now()}`,
        name: "Acme",
        gstin: "27AAAAA0000A1Z5",
      },
    });
    customerId = customer.id;
    shipToId = (
      await prisma.shipToAddress.create({
        data: {
          customerId: customer.id,
          label: "M",
          gstStateCode: "27",
          isDefault: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function issuedInvoice(taxable: bigint, total: bigint, ackAgo?: number) {
    seq += 1;
    const dn = await prisma.dispatchNote.create({
      data: {
        companyId,
        docNo: `DN/${Date.now()}-${seq}`,
        customerId,
        shipToId,
        status: "DISPATCHED",
      },
    });
    return prisma.invoice.create({
      data: {
        companyId,
        docNo: `INV/${Date.now()}-${seq}`,
        dispatchNoteId: dn.id,
        customerId,
        shipToId,
        placeOfSupplyStateCode: "27",
        taxableValuePaise: taxable,
        totalPaise: total,
        status: "ISSUED",
        lines: {
          create: [
            {
              itemId,
              description: "EPE",
              hsnCode: "39211900",
              qtyKg: "100",
              qtyM2: "400",
              ratePaise: 1250n,
              gstRatePct: "18",
              taxableValuePaise: taxable,
            },
          ],
        },
      },
    });
  }

  it("generates an IRN (mock) and is idempotent; logs the attempt", async () => {
    const inv = await issuedInvoice(500000n, 590000n);
    const out = await prisma.$transaction((tx) => generateIrn(tx, dispatch, inv.id));
    expect(out.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(out.signedQr).toBeTruthy();
    expect(out.ackNo).toBeTruthy();
    expect(out.einvoiceStatus).toBe("GENERATED");

    const again = await prisma.$transaction((tx) => generateIrn(tx, dispatch, inv.id));
    expect(again.irn).toBe(out.irn); // idempotent no-op
    // Only one OK GEN_IRN log (the no-op did not re-log).
    expect(
      await prisma.eInvoiceLog.count({
        where: { invoiceId: inv.id, action: "GEN_IRN", status: "OK" },
      }),
    ).toBe(1);
  });

  it("leaves a B2C invoice (no buyer GSTIN) as NONE, not submitted", async () => {
    // A consumer with no GSTIN — e-invoicing never applies to B2C, whatever the value.
    const b2c = await prisma.customer.create({
      data: { companyId, code: `B2C-${Date.now()}`, name: "Walk-in", gstin: null },
    });
    const b2cShipTo = await prisma.shipToAddress.create({
      data: { customerId: b2c.id, label: "M", gstStateCode: "27", isDefault: true },
    });
    const dn = await prisma.dispatchNote.create({
      data: {
        companyId,
        docNo: `DN/B2C-${Date.now()}`,
        customerId: b2c.id,
        shipToId: b2cShipTo.id,
        status: "DISPATCHED",
      },
    });
    const inv = await prisma.invoice.create({
      data: {
        companyId,
        docNo: `INV/B2C-${Date.now()}`,
        dispatchNoteId: dn.id,
        customerId: b2c.id,
        shipToId: b2cShipTo.id,
        placeOfSupplyStateCode: "27",
        taxableValuePaise: 6_000_000n, // a large value — still not e-invoiced, because B2C
        totalPaise: 7_080_000n,
        status: "ISSUED",
        lines: {
          create: [
            {
              itemId,
              description: "EPE",
              hsnCode: "39211900",
              qtyKg: "100",
              qtyM2: "400",
              ratePaise: 1250n,
              gstRatePct: "18",
              taxableValuePaise: 6_000_000n,
            },
          ],
        },
      },
    });
    const out = await prisma.$transaction((tx) => generateIrn(tx, dispatch, inv.id));
    expect(out.irn).toBeNull();
    expect(out.einvoiceStatus).toBe("NONE");
  });

  it("generates an e-way bill (needs IRN + ≥ threshold) with a validity date", async () => {
    const inv = await issuedInvoice(6_000_000n, 7_080_000n); // ₹60k > ₹50k EWB threshold
    await prisma.$transaction((tx) => generateIrn(tx, dispatch, inv.id));
    const out = await prisma.$transaction((tx) =>
      generateEwayBill(tx, dispatch, inv.id, { distanceKm: 120 }),
    );
    expect(out.ewbNo).toMatch(/^\d{12}$/);
    expect(out.ewbValidTill).not.toBeNull();
    // below threshold is refused
    const small = await issuedInvoice(100000n, 118000n);
    await prisma.$transaction((tx) => generateIrn(tx, dispatch, small.id));
    await expect(
      prisma.$transaction((tx) =>
        generateEwayBill(tx, dispatch, small.id, { distanceKm: 50 }),
      ),
    ).rejects.toBeInstanceOf(EInvoiceError);
  });

  it("cancels an IRN within the window; refuses it after; needs DISPATCH write", async () => {
    const inv = await issuedInvoice(500000n, 590000n);
    await prisma.$transaction((tx) =>
      generateIrn(tx, dispatch, inv.id, { now: new Date("2026-08-14T00:00:00Z") }),
    );

    // A SALES actor cannot cancel.
    await expect(
      prisma.$transaction((tx) =>
        cancelIrn(tx, sales, inv.id, { reason: "wrong customer" }),
      ),
    ).rejects.toBeInstanceOf(AuthzError);

    // Outside the 24h window → refused.
    await expect(
      prisma.$transaction((tx) =>
        cancelIrn(tx, dispatch, inv.id, {
          reason: "late",
          now: new Date("2026-08-16T00:00:00Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(EInvoiceError);

    // Within the window → cleared + CANCELLED.
    const out = await prisma.$transaction((tx) =>
      cancelIrn(tx, dispatch, inv.id, {
        reason: "keyed wrong GSTIN",
        now: new Date("2026-08-14T06:00:00Z"),
      }),
    );
    expect(out.irn).toBeNull();
    expect(out.einvoiceStatus).toBe("CANCELLED");
    expect(
      await prisma.eInvoiceLog.count({
        where: { invoiceId: inv.id, action: "CANCEL_IRN", status: "OK" },
      }),
    ).toBe(1);
  });
});
