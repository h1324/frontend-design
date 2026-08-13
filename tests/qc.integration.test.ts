import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPO } from "../lib/purchasing.js";
import { createGRN, freeBulkBalance, heldBulkBalance } from "../lib/goods-receipt.js";
import { receiveRoll, itemBalance } from "../lib/stock-ledger.js";
import { agingSweep } from "../lib/aging.js";
import { inspectGrnLine, inspectLot, QcValidationError } from "../lib/qc.js";
import { AuthzError, type Actor } from "../lib/rbac.js";
import type { Dimensions } from "../lib/uom.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("quality control (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let qc: Actor;
  let sales: Actor;
  let supplierId: string;
  let ldpeId: string;
  let fgId: string;
  let holdId: string;
  let freeId: string;
  let rejectId: string;
  let machineId: string;
  let shiftId: string;
  let operatorId: string;

  const dims: Dimensions = {
    length_m: "100",
    width_m: "1.2",
    layers: [{ thickness_mm: "3", density_kg_m3: "25" }],
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `QC Co ${Date.now()}` },
    });
    companyId = company.id;
    const qcUser = await prisma.user.create({
      data: {
        companyId,
        email: `qc-${Date.now()}@t.local`,
        name: "QC",
        passwordHash: "x",
        role: "QC",
      },
    });
    const salesUser = await prisma.user.create({
      data: {
        companyId,
        email: `sa-${Date.now()}@t.local`,
        name: "Sa",
        passwordHash: "x",
        role: "SALES",
      },
    });
    qc = { userId: qcUser.id, companyId, role: "QC" };
    sales = { userId: salesUser.id, companyId, role: "SALES" };
    const supplier = await prisma.supplier.create({
      data: { companyId, code: `S-${Date.now()}`, name: "Reliance" },
    });
    supplierId = supplier.id;
    const ldpe = await prisma.item.create({
      data: {
        companyId,
        code: `LDPE-${Date.now()}`,
        name: "LDPE",
        type: "RAW_MATERIAL",
        uomBase: "KG",
      },
    });
    ldpeId = ldpe.id;
    const fg = await prisma.item.create({
      data: {
        companyId,
        code: `FG-${Date.now()}`,
        name: "EPE 3mm",
        type: "FINISHED_GOOD",
        uomBase: "M2",
        density_kg_m3: "25",
        densityTolerance: "0.5",
      },
    });
    fgId = fg.id;
    holdId = (
      await prisma.location.create({
        data: { companyId, code: `QCH-${Date.now()}`, name: "QC Hold", isQcHold: true },
      })
    ).id;
    freeId = (
      await prisma.location.create({
        data: { companyId, code: `MAIN-${Date.now()}`, name: "Main" },
      })
    ).id;
    rejectId = (
      await prisma.location.create({
        data: { companyId, code: `REJ-${Date.now()}`, name: "Reject", isReject: true },
      })
    ).id;
    machineId = (
      await prisma.machine.create({
        data: { companyId, code: `M-${Date.now()}`, name: "FLY" },
      })
    ).id;
    shiftId = (
      await prisma.shift.create({
        data: {
          companyId,
          code: `SH-${Date.now()}`,
          name: "A",
          startTime: "08:00",
          endTime: "16:00",
        },
      })
    ).id;
    operatorId = (
      await prisma.operator.create({
        data: { companyId, code: `O-${Date.now()}`, name: "Ravi" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function receivedGrnLine(qty: string) {
    const po = await prisma.$transaction((tx) =>
      createPO(
        tx,
        { userId: qc.userId, companyId, role: "ADMIN" },
        { supplierId, lines: [{ itemId: ldpeId, qtyOrdered: qty, ratePaise: 8500 }] },
      ),
    );
    const poLine = await prisma.purchaseOrderLine.findFirstOrThrow({
      where: { poId: po.id },
    });
    const grn = await prisma.$transaction((tx) =>
      createGRN(
        tx,
        { userId: qc.userId, companyId, role: "ADMIN" },
        {
          poId: po.id,
          holdLocationId: holdId,
          lines: [{ poLineId: poLine.id, itemId: ldpeId, qtyReceived: qty }],
        },
      ),
    );
    return prisma.goodsReceiptLine.findFirstOrThrow({ where: { grnId: grn.id } });
  }

  async function lotWithRoll(agingReadyDate: Date) {
    const lot = await prisma.lot.create({
      data: {
        companyId,
        lotNo: `LOT/2026-27/${crypto.randomUUID().slice(0, 8)}`,
        machineId,
        shiftId,
        operatorId,
        targetItemId: fgId,
        productionDate: new Date("2026-08-01T04:00:00Z"),
      },
    });
    const { roll } = await prisma.$transaction((tx) =>
      receiveRoll(tx, {
        companyId,
        itemId: fgId,
        locationId: freeId,
        dimensions: dims,
        actualKg: "9",
        initialState: "CURING",
        agingReadyDate,
        lotId: lot.id,
        actorUserId: qc.userId,
      }),
    );
    return { lot, roll };
  }

  it("passing a GRN line moves accepted stock hold→free; the number is gapless and audited", async () => {
    const line = await receivedGrnLine("1000");
    expect((await heldBulkBalance(prisma, companyId, ldpeId)).toString()).toBe("1000");

    const insp = await prisma.$transaction((tx) =>
      inspectGrnLine(tx, qc, line.id, { result: "PASS" }),
    );
    expect(insp.docNo).toMatch(/^QC\/\d{4}-\d{2}\/\d{6}$/);

    expect((await heldBulkBalance(prisma, companyId, ldpeId)).toString()).toBe("0");
    expect((await itemBalance(prisma, companyId, ldpeId, freeId)).toString()).toBe(
      "1000",
    );
    expect(
      (await prisma.goodsReceiptLine.findUniqueOrThrow({ where: { id: line.id } }))
        .qcStatus,
    ).toBe("PASSED");
    expect(
      await prisma.auditLog.count({
        where: { entity: "QcInspection", entityId: insp.id },
      }),
    ).toBe(1);
  });

  it("failing routes stock hold→reject; partial splits both", async () => {
    const failLine = await receivedGrnLine("200");
    await prisma.$transaction((tx) =>
      inspectGrnLine(tx, qc, failLine.id, { result: "FAIL" }),
    );
    expect((await itemBalance(prisma, companyId, ldpeId, rejectId)).toString()).toBe(
      "200",
    );

    const partLine = await receivedGrnLine("100");
    const freeBefore = await itemBalance(prisma, companyId, ldpeId, freeId);
    const rejBefore = await itemBalance(prisma, companyId, ldpeId, rejectId);
    await prisma.$transaction((tx) =>
      inspectGrnLine(tx, qc, partLine.id, { result: "PARTIAL", qtyPassed: "60" }),
    );
    expect((await itemBalance(prisma, companyId, ldpeId, freeId)).toString()).toBe(
      freeBefore.plus(60).toString(),
    );
    expect((await itemBalance(prisma, companyId, ldpeId, rejectId)).toString()).toBe(
      rejBefore.plus(40).toString(),
    );
    expect(
      (await prisma.goodsReceiptLine.findUniqueOrThrow({ where: { id: partLine.id } }))
        .qcStatus,
    ).toBe("PARTIAL");
  });

  it("a roll needs both aging and a QC pass to become AVAILABLE", async () => {
    const asOf = new Date("2026-08-10T06:00:00.000Z");
    const agedReady = new Date("2026-08-05T06:00:00.000Z"); // past
    const notReady = new Date("2026-08-20T06:00:00.000Z"); // future

    const aged = await lotWithRoll(agedReady);
    const fresh = await lotWithRoll(notReady);

    // Aging alone does not release either (QC still pending).
    await prisma.$transaction((tx) => agingSweep(tx, companyId, asOf));
    expect(
      (await prisma.roll.findUniqueOrThrow({ where: { id: aged.roll.id } })).state,
    ).toBe("CURING");

    // QC pass: the aged roll flips to AVAILABLE; the fresh roll clears QC but stays CURING.
    const r1 = await prisma.$transaction((tx) =>
      inspectLot(tx, qc, aged.lot.id, { asOf }),
    );
    expect(r1.passed).toBe(1);
    expect(r1.releasedToAvailable).toBe(1);
    expect(
      (await prisma.roll.findUniqueOrThrow({ where: { id: aged.roll.id } })).state,
    ).toBe("AVAILABLE");

    const r2 = await prisma.$transaction((tx) =>
      inspectLot(tx, qc, fresh.lot.id, { asOf }),
    );
    expect(r2.releasedToAvailable).toBe(0);
    const freshRoll = await prisma.roll.findUniqueOrThrow({
      where: { id: fresh.roll.id },
    });
    expect(freshRoll.state).toBe("CURING");
    expect(freshRoll.qcStatus).toBe("PASSED");

    // Now aging sweep releases the QC-passed fresh roll once it is aged.
    await prisma.$transaction((tx) =>
      agingSweep(tx, companyId, new Date("2026-08-21T06:00:00Z")),
    );
    expect(
      (await prisma.roll.findUniqueOrThrow({ where: { id: fresh.roll.id } })).state,
    ).toBe("AVAILABLE");
  });

  it("a failed roll goes REJECTED; density reading + variance persist", async () => {
    const { lot, roll } = await lotWithRoll(new Date("2026-08-05T06:00:00Z"));
    await prisma.$transaction((tx) =>
      inspectLot(tx, qc, lot.id, {
        failedRollIds: [roll.id],
        asOf: new Date("2026-08-10T06:00:00Z"),
      }),
    );
    const rejected = await prisma.roll.findUniqueOrThrow({ where: { id: roll.id } });
    expect(rejected.state).toBe("REJECTED");
    expect(rejected.qcStatus).toBe("FAILED");

    const insp = await prisma.qcInspection.findFirstOrThrow({
      where: { refType: "ROLL", refId: roll.id },
      include: { readings: true },
    });
    const density = insp.readings.find((r) => r.metric === "DENSITY");
    expect(density?.value?.toString()).toBe("25"); // composite density, within the ±0.5 band
    expect(density?.withinSpec).toBe(true);
  });

  it("denies a non-QC actor and rejects re-inspecting a done line", async () => {
    const line = await receivedGrnLine("10");
    await expect(
      prisma.$transaction((tx) => inspectGrnLine(tx, sales, line.id, { result: "PASS" })),
    ).rejects.toBeInstanceOf(AuthzError);

    await prisma.$transaction((tx) =>
      inspectGrnLine(tx, qc, line.id, { result: "PASS" }),
    );
    await expect(
      prisma.$transaction((tx) => inspectGrnLine(tx, qc, line.id, { result: "PASS" })),
    ).rejects.toBeInstanceOf(QcValidationError);
  });
});
