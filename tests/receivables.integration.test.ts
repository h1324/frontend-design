import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  recordReceipt,
  allocateReceipt,
  cancelReceipt,
  customerOutstandingPaise,
  customerAgeing,
  ReceivablesValidationError,
} from "../lib/receivables.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const day = 86_400_000;

suite("receivables (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let accounts: Actor;
  let sales: Actor;
  let customerId: string;
  let shipToId: string;
  let seq = 0;

  const asOf = new Date("2026-08-11T06:30:00Z");

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `RCV Co ${Date.now()}` },
    });
    companyId = company.id;
    const acct = await prisma.user.create({
      data: {
        companyId,
        email: `rc-ac-${Date.now()}@t.local`,
        name: "Ac",
        passwordHash: "x",
        role: "ACCOUNTS",
      },
    });
    const sa = await prisma.user.create({
      data: {
        companyId,
        email: `rc-sa-${Date.now()}@t.local`,
        name: "Sa",
        passwordHash: "x",
        role: "SALES",
      },
    });
    accounts = { userId: acct.id, companyId, role: "ACCOUNTS" };
    sales = { userId: sa.id, companyId, role: "SALES" };
    const customer = await prisma.customer.create({
      data: { companyId, code: `C-${Date.now()}`, name: "Acme", creditDays: 30 },
    });
    customerId = customer.id;
    shipToId = (
      await prisma.shipToAddress.create({
        data: {
          customerId: customer.id,
          label: "Main",
          gstStateCode: "27",
          isDefault: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Create an ISSUED invoice (via a minimal dispatch note) with a given total and due date. */
  async function issuedInvoice(totalPaise: bigint, dueDate: Date) {
    seq += 1;
    const note = await prisma.dispatchNote.create({
      data: {
        companyId,
        docNo: `DN/T/${Date.now()}-${seq}`,
        customerId,
        shipToId,
        status: "DISPATCHED",
      },
    });
    return prisma.invoice.create({
      data: {
        companyId,
        docNo: `INV/T/${Date.now()}-${seq}`,
        dispatchNoteId: note.id,
        customerId,
        shipToId,
        placeOfSupplyStateCode: "27",
        taxableValuePaise: totalPaise,
        totalPaise,
        dueDate,
        status: "ISSUED",
      },
    });
  }

  it("outstanding starts at the sum of issued invoice totals", async () => {
    const before = await customerOutstandingPaise(prisma, companyId, customerId);
    await issuedInvoice(100000n, new Date(asOf.getTime() + 10 * day)); // not due
    await issuedInvoice(60000n, new Date(asOf.getTime() - 45 * day)); // overdue 45d
    const after = await customerOutstandingPaise(prisma, companyId, customerId);
    expect(after - before).toBe(160000n);
  });

  it("recording + allocating a receipt lowers outstanding; over-allocation is rejected", async () => {
    const inv = await issuedInvoice(50000n, new Date(asOf.getTime() - 5 * day));
    const before = await customerOutstandingPaise(prisma, companyId, customerId);

    const receipt = await prisma.$transaction((tx) =>
      recordReceipt(tx, accounts, {
        customerId,
        amountPaise: 30000n,
        allocations: [{ invoiceId: inv.id, amountPaise: 30000n }],
      }),
    );
    expect(receipt.docNo).toMatch(/^RCT\/\d{4}-\d{2}\/\d{6}$/);

    const after = await customerOutstandingPaise(prisma, companyId, customerId);
    expect(before - after).toBe(30000n); // outstanding fell by the receipt amount
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } }))
        .amountSettledPaise,
    ).toBe(30000n);

    // Allocating another 30000 on a 30000 receipt (already fully allocated) → over-allocation.
    await expect(
      prisma.$transaction((tx) =>
        allocateReceipt(tx, accounts, receipt.id, [
          { invoiceId: inv.id, amountPaise: 30000n },
        ]),
      ),
    ).rejects.toBeInstanceOf(ReceivablesValidationError);
  });

  it("rejects settling an invoice beyond its total", async () => {
    const inv = await issuedInvoice(20000n, new Date(asOf.getTime() - 5 * day));
    await expect(
      prisma.$transaction((tx) =>
        recordReceipt(tx, accounts, {
          customerId,
          amountPaise: 25000n,
          allocations: [{ invoiceId: inv.id, amountPaise: 25000n }], // > invoice total
        }),
      ),
    ).rejects.toBeInstanceOf(ReceivablesValidationError);
  });

  it("denies a non-ACCOUNTS/ADMIN actor from recording receipts", async () => {
    await expect(
      prisma.$transaction((tx) =>
        recordReceipt(tx, sales, { customerId, amountPaise: 1000n }),
      ),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("ages unsettled balances into buckets by due date", async () => {
    // Fresh customer to isolate the ageing sums.
    const c = await prisma.customer.create({
      data: { companyId, code: `CA-${Date.now()}`, name: "Ageing", creditDays: 0 },
    });
    const cid = c.id;
    const st = await prisma.shipToAddress.create({
      data: { customerId: cid, label: "M", gstStateCode: "27", isDefault: true },
    });
    async function inv(total: bigint, due: Date) {
      seq += 1;
      const n = await prisma.dispatchNote.create({
        data: {
          companyId,
          docNo: `DNA/${Date.now()}-${seq}`,
          customerId: cid,
          shipToId: st.id,
          status: "DISPATCHED",
        },
      });
      return prisma.invoice.create({
        data: {
          companyId,
          docNo: `INVA/${Date.now()}-${seq}`,
          dispatchNoteId: n.id,
          customerId: cid,
          shipToId: st.id,
          placeOfSupplyStateCode: "27",
          taxableValuePaise: total,
          totalPaise: total,
          dueDate: due,
          status: "ISSUED",
        },
      });
    }
    await inv(100000n, new Date(asOf.getTime() + 5 * day)); // current
    await inv(50000n, new Date(asOf.getTime() - 15 * day)); // 0-30
    await inv(25000n, new Date(asOf.getTime() - 75 * day)); // 61-90

    const ageing = await customerAgeing(prisma, companyId, cid, asOf);
    expect(ageing.buckets.current).toBe(100000n);
    expect(ageing.buckets.d0_30).toBe(50000n);
    expect(ageing.buckets.d61_90).toBe(25000n);
    expect(ageing.buckets.total).toBe(175000n);
    expect(ageing.outstandingPaise).toBe(175000n);
  });

  it("cancelling a receipt unwinds the receivable and keeps the number", async () => {
    const inv = await issuedInvoice(40000n, new Date(asOf.getTime() - 5 * day));
    const receipt = await prisma.$transaction((tx) =>
      recordReceipt(tx, accounts, {
        customerId,
        amountPaise: 40000n,
        allocations: [{ invoiceId: inv.id, amountPaise: 40000n }],
      }),
    );
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } }))
        .amountSettledPaise,
    ).toBe(40000n);
    const outWith = await customerOutstandingPaise(prisma, companyId, customerId);

    const cancelled = await prisma.$transaction((tx) =>
      cancelReceipt(tx, accounts, receipt.id),
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.docNo).toBe(receipt.docNo); // number retained
    expect(
      (await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } }))
        .amountSettledPaise,
    ).toBe(0n);
    const outAfter = await customerOutstandingPaise(prisma, companyId, customerId);
    expect(outAfter - outWith).toBe(40000n); // receivable restored
  });
});
