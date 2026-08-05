import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { receiveRoll, availableRolls } from "../lib/stock-ledger.js";
import {
  createDispatch,
  generateInvoice,
  cancelInvoice,
  cancelDispatch,
  traceRoll,
  DispatchValidationError,
} from "../lib/dispatch.js";
import { AuthzError, type Actor } from "../lib/rbac.js";
import type { Dimensions } from "../lib/uom.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

const RATE = 4250; // paise per m² (₹42.50)

suite("dispatch & invoice (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let dispatch: Actor;
  let sales: Actor;
  let itemId: string;
  let locationId: string;
  let customerId: string;
  let shipIntraId: string; // same state as seller (27)
  let shipInterId: string; // different state (24)
  let lotId: string;

  const dims: Dimensions = {
    length_m: "100",
    width_m: "1.2",
    layers: [{ thickness_mm: "3", density_kg_m3: "25" }],
  }; // 120 m² per roll

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `Dispatch Co ${Date.now()}`, gstin: "27ABCDE1234F1Z5" }, // seller state 27
    });
    companyId = company.id;
    const disUser = await prisma.user.create({
      data: {
        companyId,
        email: `di-${Date.now()}@t.local`,
        name: "Dispatch",
        passwordHash: "x",
        role: "DISPATCH",
      },
    });
    const salesUser = await prisma.user.create({
      data: {
        companyId,
        email: `sa-${Date.now()}@t.local`,
        name: "Sales",
        passwordHash: "x",
        role: "SALES",
      },
    });
    dispatch = { userId: disUser.id, companyId, role: "DISPATCH" };
    sales = { userId: salesUser.id, companyId, role: "SALES" };

    const item = await prisma.item.create({
      data: {
        companyId,
        code: `FG-${Date.now()}`,
        name: "EPE 3mm roll",
        type: "FINISHED_GOOD",
        uomBase: "M2",
        hsnCode: "39211900",
        gstRatePct: "18",
      },
    });
    itemId = item.id;
    const location = await prisma.location.create({
      data: { companyId, name: "Dock", code: `L-${Date.now()}` },
    });
    locationId = location.id;

    const customer = await prisma.customer.create({
      data: { companyId, code: `C-${Date.now()}`, name: "Acme Mattress Co" },
    });
    customerId = customer.id;
    const intra = await prisma.shipToAddress.create({
      data: { customerId: customer.id, label: "Pune plant", gstStateCode: "27" },
    });
    shipIntraId = intra.id;
    const inter = await prisma.shipToAddress.create({
      data: { customerId: customer.id, label: "Surat DC", gstStateCode: "24" },
    });
    shipInterId = inter.id;

    // A lot so genealogy has a chain to trace.
    const machine = await prisma.machine.create({
      data: { companyId, code: `M-${Date.now()}`, name: "FLY-250" },
    });
    const shift = await prisma.shift.create({
      data: {
        companyId,
        code: `S-${Date.now()}`,
        name: "A",
        startTime: "08:00",
        endTime: "16:00",
      },
    });
    const operator = await prisma.operator.create({
      data: { companyId, code: `O-${Date.now()}`, name: "Ravi" },
    });
    const lot = await prisma.lot.create({
      data: {
        companyId,
        lotNo: `LOT/2026-27/${Date.now()}`,
        machineId: machine.id,
        shiftId: shift.id,
        operatorId: operator.id,
        targetItemId: itemId,
        productionDate: new Date("2026-08-01T04:00:00.000Z"),
      },
    });
    lotId = lot.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function availableRoll() {
    const { roll } = await prisma.$transaction((tx) =>
      receiveRoll(tx, {
        companyId,
        itemId,
        locationId,
        dimensions: dims,
        actualKg: "9",
        initialState: "AVAILABLE",
        lotId,
        actorUserId: dispatch.userId,
      }),
    );
    return roll;
  }

  const seq = (docNo: string) => Number(docNo.split("/")[2]);

  it("intra-state dispatch yields CGST+SGST; rolls flip DISPATCHED and leave availability", async () => {
    const r1 = await availableRoll();
    const r2 = await availableRoll();

    const note = await prisma.$transaction((tx) =>
      createDispatch(tx, dispatch, {
        customerId,
        shipToId: shipIntraId,
        rollIds: [r1.id, r2.id],
        transporter: "VRL",
        vehicleNo: "MH12AB1234",
      }),
    );
    expect(note.docNo).toMatch(/^DN\/\d{4}-\d{2}\/\d{6}$/);
    // Both rolls allocated.
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: r1.id } })).state).toBe(
      "ALLOCATED",
    );

    const invoice = await prisma.$transaction((tx) =>
      generateInvoice(tx, dispatch, note.id, { ratesPaise: { [itemId]: RATE } }),
    );
    expect(invoice.docNo).toMatch(/^INV\/\d{4}-\d{2}\/\d{6}$/);
    expect(invoice.placeOfSupplyStateCode).toBe("27");

    // 240 m² × 4250 = 1,020,000 taxable; 18% intra → 91,800 each half; igst 0.
    expect(invoice.taxableValuePaise).toBe(1_020_000n);
    expect(invoice.cgstPaise).toBe(91_800n);
    expect(invoice.sgstPaise).toBe(91_800n);
    expect(invoice.igstPaise).toBe(0n);
    // totals reconcile: taxable + taxes + roundOff = total
    const recon =
      invoice.taxableValuePaise +
      invoice.cgstPaise +
      invoice.sgstPaise +
      invoice.igstPaise +
      invoice.roundOffPaise;
    expect(recon).toBe(invoice.totalPaise);

    // Rolls dispatched with SERIAL OUT, gone from availability.
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: r1.id } })).state).toBe(
      "DISPATCHED",
    );
    const outs = await prisma.stockLedger.count({
      where: {
        grain: "SERIAL",
        direction: "OUT",
        reason: "DISPATCH",
        rollId: { in: [r1.id, r2.id] },
      },
    });
    expect(outs).toBe(2);
    const avail = await availableRolls(prisma, companyId, itemId, new Date());
    expect(avail.map((r) => r.id)).not.toContain(r1.id);

    // Line carries both kg and m² and the HSN.
    const line = await prisma.invoiceLine.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect(line.qtyM2.toString()).toBe("240");
    expect(line.qtyKg.toString()).toBe("18"); // 9 + 9
    expect(line.hsnCode).toBe("39211900");
  });

  it("inter-state dispatch yields IGST; place of supply is the ship-to state", async () => {
    const r = await availableRoll();
    const note = await prisma.$transaction((tx) =>
      createDispatch(tx, dispatch, {
        customerId,
        shipToId: shipInterId,
        rollIds: [r.id],
      }),
    );
    const invoice = await prisma.$transaction((tx) =>
      generateInvoice(tx, dispatch, note.id, { ratesPaise: { [itemId]: RATE } }),
    );
    expect(invoice.placeOfSupplyStateCode).toBe("24");
    // 120 m² × 4250 = 510,000 taxable; 18% inter → igst 91,800; cgst/sgst 0.
    expect(invoice.igstPaise).toBe(91_800n);
    expect(invoice.cgstPaise).toBe(0n);
    expect(invoice.sgstPaise).toBe(0n);
  });

  it("dispatch & invoice numbers are gapless per FY", async () => {
    const rolls = [await availableRoll(), await availableRoll()];
    const noteA = await prisma.$transaction((tx) =>
      createDispatch(tx, dispatch, {
        customerId,
        shipToId: shipIntraId,
        rollIds: [rolls[0]!.id],
      }),
    );
    const noteB = await prisma.$transaction((tx) =>
      createDispatch(tx, dispatch, {
        customerId,
        shipToId: shipIntraId,
        rollIds: [rolls[1]!.id],
      }),
    );
    expect(seq(noteB.docNo)).toBe(seq(noteA.docNo) + 1);

    const invA = await prisma.$transaction((tx) =>
      generateInvoice(tx, dispatch, noteA.id, { ratesPaise: { [itemId]: RATE } }),
    );
    const invB = await prisma.$transaction((tx) =>
      generateInvoice(tx, dispatch, noteB.id, { ratesPaise: { [itemId]: RATE } }),
    );
    expect(seq(invB.docNo)).toBe(seq(invA.docNo) + 1);
  });

  it("cancelling an invoice reverses stock and keeps its number; rolls return to AVAILABLE", async () => {
    const r = await availableRoll();
    const note = await prisma.$transaction((tx) =>
      createDispatch(tx, dispatch, {
        customerId,
        shipToId: shipIntraId,
        rollIds: [r.id],
      }),
    );
    const invoice = await prisma.$transaction((tx) =>
      generateInvoice(tx, dispatch, note.id, { ratesPaise: { [itemId]: RATE } }),
    );
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: r.id } })).state).toBe(
      "DISPATCHED",
    );

    const cancelled = await prisma.$transaction((tx) =>
      cancelInvoice(tx, dispatch, invoice.id),
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.docNo).toBe(invoice.docNo); // number retained

    // Roll back to AVAILABLE, dispatch note cancelled, SERIAL OUT reversed.
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: r.id } })).state).toBe(
      "AVAILABLE",
    );
    expect(
      (await prisma.dispatchNote.findUniqueOrThrow({ where: { id: note.id } })).status,
    ).toBe("CANCELLED");
    const rev = await prisma.stockLedger.count({
      where: { grain: "SERIAL", reason: "REVERSAL", rollId: r.id },
    });
    expect(rev).toBe(1);
    const availAgain = await availableRolls(prisma, companyId, itemId, new Date());
    expect(availAgain.map((x) => x.id)).toContain(r.id);
  });

  it("cancels an OPEN dispatch by de-allocating its rolls; refuses once invoiced", async () => {
    const r = await availableRoll();
    const note = await prisma.$transaction((tx) =>
      createDispatch(tx, dispatch, {
        customerId,
        shipToId: shipIntraId,
        rollIds: [r.id],
      }),
    );
    await prisma.$transaction((tx) => cancelDispatch(tx, dispatch, note.id));
    expect((await prisma.roll.findUniqueOrThrow({ where: { id: r.id } })).state).toBe(
      "AVAILABLE",
    );

    // A dispatched (invoiced) note refuses cancelDispatch.
    const r2 = await availableRoll();
    const note2 = await prisma.$transaction((tx) =>
      createDispatch(tx, dispatch, {
        customerId,
        shipToId: shipIntraId,
        rollIds: [r2.id],
      }),
    );
    await prisma.$transaction((tx) =>
      generateInvoice(tx, dispatch, note2.id, { ratesPaise: { [itemId]: RATE } }),
    );
    await expect(
      prisma.$transaction((tx) => cancelDispatch(tx, dispatch, note2.id)),
    ).rejects.toBeInstanceOf(DispatchValidationError);
  });

  it("genealogy: a dispatched roll traces back to its lot; non-dispatch actor is denied", async () => {
    const r = await availableRoll();
    const note = await prisma.$transaction((tx) =>
      createDispatch(tx, dispatch, {
        customerId,
        shipToId: shipIntraId,
        rollIds: [r.id],
      }),
    );
    await prisma.$transaction((tx) =>
      generateInvoice(tx, dispatch, note.id, { ratesPaise: { [itemId]: RATE } }),
    );

    const trace = await traceRoll(prisma, companyId, r.id);
    expect(trace?.lot?.id).toBe(lotId);
    expect(trace?.dispatchRolls[0]?.dispatchNote.invoice?.docNo).toBeTruthy();

    // A SALES actor cannot dispatch.
    await expect(
      prisma.$transaction((tx) =>
        createDispatch(tx, sales, { customerId, shipToId: shipIntraId, rollIds: [r.id] }),
      ),
    ).rejects.toBeInstanceOf(AuthzError);
  });
});
