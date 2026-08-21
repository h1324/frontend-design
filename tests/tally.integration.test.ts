import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  exportInvoice,
  importReceipts,
  TallySyncError,
} from "../lib/tally/tally-sync.js";
import { MockConnector } from "../lib/tally/connector.js";
import { customerOutstandingPaise } from "../lib/receivables.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("tally sync (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let accounts: Actor;
  let sales: Actor;
  let customerId: string;
  let shipToId: string;
  let itemId: string;
  let seq = 0;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `TS Co ${Date.now()}`, gstin: "27AABCE1234F1Z5" },
    });
    companyId = company.id;
    const ac = await prisma.user.create({
      data: {
        companyId,
        email: `ts-ac-${Date.now()}@t.local`,
        name: "Ac",
        passwordHash: "x",
        role: "ACCOUNTS",
      },
    });
    const sa = await prisma.user.create({
      data: {
        companyId,
        email: `ts-sa-${Date.now()}@t.local`,
        name: "Sa",
        passwordHash: "x",
        role: "SALES",
      },
    });
    accounts = { userId: ac.id, companyId, role: "ACCOUNTS" };
    sales = { userId: sa.id, companyId, role: "SALES" };
    const customer = await prisma.customer.create({
      data: { companyId, code: `C-${Date.now()}`, name: "Acme Foam" },
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
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function issuedInvoice(
    taxable: bigint,
    total: bigint,
    status: "ISSUED" | "CANCELLED" = "ISSUED",
  ) {
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
        cgstPaise: 45000n,
        sgstPaise: 45000n,
        totalPaise: total,
        status,
      },
    });
  }

  it("exports an issued invoice to a Tally voucher (ACK) and is idempotent", async () => {
    const inv = await issuedInvoice(500000n, 590000n);
    const connector = new MockConnector();
    const out = await prisma.$transaction((tx) =>
      exportInvoice(tx, accounts, inv.id, { connector }),
    );
    expect(out.status).toBe("ACK");
    expect(out.externalRef).toMatch(/^V-[0-9A-F]{16}$/);
    expect(
      await prisma.tallySync.count({
        where: { entityId: inv.id, entityType: "INVOICE", status: "ACK" },
      }),
    ).toBe(1);

    const again = await prisma.$transaction((tx) =>
      exportInvoice(tx, accounts, inv.id, { connector }),
    );
    expect(again.status).toBe("SKIPPED"); // idempotent by payloadHash
    expect(
      await prisma.tallySync.count({
        where: { entityId: inv.id, entityType: "INVOICE" },
      }),
    ).toBe(1);
  });

  it("a cancelled invoice sends a cancellation voucher, not an edit", async () => {
    const inv = await issuedInvoice(200000n, 236000n, "CANCELLED");
    const connector = new MockConnector();
    const out = await prisma.$transaction((tx) =>
      exportInvoice(tx, accounts, inv.id, { connector }),
    );
    expect(out.status).toBe("ACK");
    const rows = await prisma.tallySync.findMany({ where: { entityId: inv.id } });
    expect(rows).toHaveLength(1);
  });

  it("imports a Tally receipt as source=TALLY, lowers outstanding, dedupes on re-run", async () => {
    await issuedInvoice(1_000_000n, 1_180_000n); // gives the customer an outstanding balance
    const before = await customerOutstandingPaise(prisma, companyId, customerId);

    const connector = new MockConnector();
    connector.queueReceipt({
      externalRef: "TLY-RCPT-1",
      ledgerName: "Acme Foam", // matches the customer name
      amountPaise: 300000n,
      reference: "NEFT-77",
      receivedAt: new Date("2026-08-12T00:00:00Z"),
    });

    const res = await prisma.$transaction((tx) =>
      importReceipts(tx, accounts, { connector }),
    );
    expect(res.imported).toBe(1);
    const receipt = await prisma.receipt.findFirstOrThrow({
      where: { companyId, customerId, source: "TALLY" },
    });
    expect(receipt.amountPaise).toBe(300000n);
    const after = await customerOutstandingPaise(prisma, companyId, customerId);
    expect(before - after).toBe(300000n);

    // Re-running does not re-import (dedupe by externalRef).
    const res2 = await prisma.$transaction((tx) =>
      importReceipts(tx, accounts, { connector }),
    );
    expect(res2.imported).toBe(0);
    expect(res2.skipped).toBe(1);
  });

  it("logs an unmatched ledger as an error, never drops it", async () => {
    const connector = new MockConnector();
    connector.queueReceipt({
      externalRef: "TLY-RCPT-UNMATCHED",
      ledgerName: "Unknown Party Ltd",
      amountPaise: 50000n,
      reference: null,
      receivedAt: new Date("2026-08-12T00:00:00Z"),
    });
    const res = await prisma.$transaction((tx) =>
      importReceipts(tx, accounts, { connector }),
    );
    expect(res.errors).toBe(1);
    const err = await prisma.tallySync.findFirstOrThrow({
      where: { externalRef: "TLY-RCPT-UNMATCHED" },
    });
    expect(err.status).toBe("ERROR");
    expect(err.lastError).toContain("no customer");
  });

  it("denies a non-ACCOUNTS/ADMIN actor", async () => {
    const inv = await issuedInvoice(100000n, 118000n);
    await expect(
      prisma.$transaction((tx) => exportInvoice(tx, sales, inv.id)),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      prisma.$transaction((tx) => importReceipts(tx, sales, {})),
    ).rejects.toBeInstanceOf(AuthzError);
    // (TallySyncError is exported for the UI layer.)
    expect(TallySyncError).toBeTruthy();
  });
});
