import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  availableOnHand,
  consumptionInWindow,
  preferredSupplierFor,
  reorderBoard,
  runReorderScan,
  draftPoFromSuggestion,
  dismissSuggestion,
  setReorderPolicy,
  ReorderError,
} from "../lib/reorder.js";
import { AuthzError, type Actor } from "../lib/rbac.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("predictive reorder (integration)", () => {
  let prisma: PrismaClient;
  let companyId: string;
  let stores: Actor;
  let viewer: Actor;
  let freeLocId: string;
  let qcLocId: string;
  let butaneId: string; // RM, below point after issues
  let talcId: string; // RM, comfortably stocked
  let supplierId: string;
  let seq = 0;

  const docNo = (p: string) => `${p}/26-27/${String(++seq).padStart(4, "0")}`;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const company = await prisma.company.create({
      data: { name: `RO Co ${Date.now()}`, gstin: "27AABCE1234F1Z5" },
    });
    companyId = company.id;

    const mkUser = async (role: "STORES" | "VIEWER") =>
      prisma.user.create({
        data: {
          companyId,
          email: `ro-${role}-${Date.now()}@t.local`,
          name: role,
          passwordHash: "x",
          role,
        },
      });
    stores = { userId: (await mkUser("STORES")).id, companyId, role: "STORES" };
    viewer = { userId: (await mkUser("VIEWER")).id, companyId, role: "VIEWER" };

    const freeLoc = await prisma.location.create({
      data: { companyId, name: "RM Store", code: "RM" },
    });
    freeLocId = freeLoc.id;
    const qcLoc = await prisma.location.create({
      data: { companyId, name: "QC Hold", code: "QCH", isQcHold: true },
    });
    qcLocId = qcLoc.id;

    // Butane: 5-day lead, 100 kg safety. Consumption seeded to 20 kg/day over 90 days
    // → reorder point 200; on-hand set below it.
    const butane = await prisma.item.create({
      data: {
        companyId,
        code: "RM-BUTANE",
        name: "Butane (blowing agent)",
        type: "RAW_MATERIAL",
        uomBase: "KG",
        leadTimeDays: 5,
        safetyStock: "100",
        reorderPolicy: "AUTO_SUGGEST",
        movingAvgCostPaise: 8000n,
      },
    });
    butaneId = butane.id;

    // Talc: same policy, but well stocked and low consumption → never trips.
    const talc = await prisma.item.create({
      data: {
        companyId,
        code: "RM-TALC",
        name: "Talc filler",
        type: "RAW_MATERIAL",
        uomBase: "KG",
        leadTimeDays: 7,
        safetyStock: "50",
        reorderPolicy: "AUTO_SUGGEST",
        movingAvgCostPaise: 1500n,
      },
    });
    talcId = talc.id;

    supplierId = (
      await prisma.supplier.create({
        data: { companyId, code: "SUP-BUT", name: "Butane India Pvt Ltd" },
      })
    ).id;

    // On-hand: butane 60 kg free + 500 kg in QC-hold (must be excluded); talc 1000 kg free.
    await prisma.stockBalance.createMany({
      data: [
        { companyId, itemId: butaneId, locationId: freeLocId, qtyBase: "60" },
        { companyId, itemId: butaneId, locationId: qcLocId, qtyBase: "500" },
        { companyId, itemId: talcId, locationId: freeLocId, qtyBase: "1000" },
      ],
    });

    // Consumption: 1800 kg butane over the last ~30 days (well within a 90-day window)
    // → avgDaily = 1800/90 = 20 kg/day. One POSTED issue, plus one CANCELLED that must be ignored.
    const issue = await prisma.materialIssue.create({
      data: {
        companyId,
        docNo: docNo("ISS"),
        status: "POSTED",
        issuedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.materialIssueLine.create({
      data: {
        issueId: issue.id,
        itemId: butaneId,
        locationId: freeLocId,
        qtyBase: "1800",
      },
    });
    const cancelled = await prisma.materialIssue.create({
      data: {
        companyId,
        docNo: docNo("ISS"),
        status: "CANCELLED",
        issuedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.materialIssueLine.create({
      data: {
        issueId: cancelled.id,
        itemId: butaneId,
        locationId: freeLocId,
        qtyBase: "9999",
      },
    });

    // Prior purchase history → preferred supplier for butane.
    await prisma.purchaseOrder.create({
      data: {
        companyId,
        docNo: docNo("PO"),
        supplierId,
        status: "OPEN",
        orderDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        lines: {
          create: {
            itemId: butaneId,
            qtyOrdered: "500",
            uom: "KG",
            ratePaise: 8000n,
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("availableOnHand excludes QC-hold stock", async () => {
    const onHand = await availableOnHand(prisma, companyId, butaneId);
    expect(onHand.toString()).toBe("60"); // 500 kg in QC-hold excluded
  });

  it("consumptionInWindow sums POSTED issues only", async () => {
    const total = await consumptionInWindow(prisma, companyId, butaneId, 90);
    expect(total.toString()).toBe("1800"); // cancelled 9999 ignored
  });

  it("preferredSupplierFor reads PO history", async () => {
    expect(await preferredSupplierFor(prisma, companyId, butaneId)).toBe(supplierId);
    expect(await preferredSupplierFor(prisma, companyId, talcId)).toBeNull();
  });

  it("reorderBoard computes the live picture, most-urgent first", async () => {
    const board = await reorderBoard(prisma, stores);
    const butane = board.find((l) => l.itemId === butaneId)!;
    const talc = board.find((l) => l.itemId === talcId)!;
    expect(butane).toBeTruthy();
    expect(butane.avgDailyConsumption.toString()).toBe("20");
    expect(butane.effectiveReorderPoint.toString()).toBe("200"); // 20×5 + 100
    expect(butane.belowPoint).toBe(true); // on-hand 60 ≤ 200
    // target 200 + 20×5 = 300; suggest 300 − 60 = 240
    expect(butane.suggestedQty.toString()).toBe("240");
    expect(butane.preferredSupplierId).toBe(supplierId);
    expect(talc.belowPoint).toBe(false); // 1000 on hand, tiny consumption
    // urgent (below point) sorts ahead of the covered item
    expect(board.indexOf(butane)).toBeLessThan(board.indexOf(talc));
  });

  it("board is VIEWER-readable (STORES read grant)", async () => {
    const board = await reorderBoard(prisma, viewer);
    expect(board.length).toBeGreaterThan(0);
  });

  it("runReorderScan materialises an OPEN snapshot for the tripped item only", async () => {
    const created = await runReorderScan(prisma, stores);
    expect(created.map((s) => s.itemId)).toContain(butaneId);
    expect(created.map((s) => s.itemId)).not.toContain(talcId);
    const snap = created.find((s) => s.itemId === butaneId)!;
    expect(snap.status).toBe("OPEN");
    expect(snap.onHandQty.toString()).toBe("60");
    expect(snap.reorderPoint.toString()).toBe("200");
    expect(snap.suggestedQty.toString()).toBe("240");
    expect(snap.preferredSupplierId).toBe(supplierId);
  });

  it("re-scanning expires the prior OPEN suggestion", async () => {
    const first = await prisma.reorderSuggestion.findFirst({
      where: { companyId, itemId: butaneId, status: "OPEN" },
    });
    await runReorderScan(prisma, stores);
    const openNow = await prisma.reorderSuggestion.findMany({
      where: { companyId, itemId: butaneId, status: "OPEN" },
    });
    expect(openNow.length).toBe(1); // exactly one live suggestion
    expect(openNow[0]!.id).not.toBe(first!.id);
    const prior = await prisma.reorderSuggestion.findUnique({ where: { id: first!.id } });
    expect(prior!.status).toBe("EXPIRED");
  });

  it("draftPoFromSuggestion creates a DRAFT PO, links it, and marks PO_DRAFTED", async () => {
    const open = await prisma.reorderSuggestion.findFirst({
      where: { companyId, itemId: butaneId, status: "OPEN" },
    });
    const { poId, suggestion } = await draftPoFromSuggestion(prisma, stores, open!.id);
    expect(suggestion.status).toBe("PO_DRAFTED");
    expect(suggestion.resultPoId).toBe(poId);
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lines: true },
    });
    expect(po!.status).toBe("DRAFT"); // never auto-confirmed
    expect(po!.supplierId).toBe(supplierId);
    expect(po!.lines[0]!.itemId).toBe(butaneId);
    expect(po!.lines[0]!.qtyOrdered.toString()).toBe("240");
    expect(po!.lines[0]!.ratePaise).toBe(8000n); // moving-average cost
  });

  it("draftPoFromSuggestion refuses a non-OPEN suggestion", async () => {
    const drafted = await prisma.reorderSuggestion.findFirst({
      where: { companyId, itemId: butaneId, status: "PO_DRAFTED" },
    });
    await expect(draftPoFromSuggestion(prisma, stores, drafted!.id)).rejects.toThrow(
      ReorderError,
    );
  });

  it("dismissSuggestion requires a reason and sets DISMISSED", async () => {
    const fresh = await runReorderScan(prisma, stores);
    const open = fresh.find((s) => s.itemId === butaneId)!;
    await expect(dismissSuggestion(prisma, stores, open.id, "   ")).rejects.toThrow(
      ReorderError,
    );
    const done = await dismissSuggestion(
      prisma,
      stores,
      open.id,
      "using a substitute lot",
    );
    expect(done.status).toBe("DISMISSED");
    expect(done.dismissedReason).toBe("using a substitute lot");
  });

  it("setReorderPolicy edits thresholds and audits the previous values", async () => {
    await setReorderPolicy(prisma, stores, talcId, {
      leadTimeDays: 14,
      safetyStock: "80",
      reorderPolicy: "MANUAL",
    });
    const it = await prisma.item.findUnique({ where: { id: talcId } });
    expect(it!.leadTimeDays).toBe(14);
    expect(it!.safetyStock!.toString()).toBe("80");
    expect(it!.reorderPolicy).toBe("MANUAL");
    const audit = await prisma.auditLog.findFirst({
      where: { companyId, entity: "Item", entityId: talcId, action: "REORDER_POLICY" },
      orderBy: { at: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("a MANUAL-policy item drops out of the scan", async () => {
    // talc was flipped to MANUAL above
    const board = await reorderBoard(prisma, stores);
    expect(board.find((l) => l.itemId === talcId)).toBeUndefined();
  });

  it("STORES-write is enforced on mutations", async () => {
    await expect(runReorderScan(prisma, viewer)).rejects.toThrow(AuthzError);
    await expect(
      setReorderPolicy(prisma, viewer, butaneId, { leadTimeDays: 3 }),
    ).rejects.toThrow(AuthzError);
  });
});
