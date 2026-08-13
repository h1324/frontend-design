// lib/qc.ts — quality control (spec S16).
// Gate stock on quality. Incoming RM (a GRN line, S15) sits on a QC-hold location until an
// inspection passes it (transfer hold→free), fails it (hold→reject), or splits it. A produced
// roll (S10/S11) needs a QC pass — the second, independent gate alongside aging (S12) — before
// it can become AVAILABLE; a failed roll goes REJECTED. Density is the defining EPE quality
// spec (CLAUDE.md): roll QC records the measured-vs-target density variance as a KPI, never an
// error. Readings are stored with their in-spec flag; dispositions are gapless-numbered and
// audited; nothing is deleted (re-inspection is a new record). QC-write gated.

import type { Prisma, QcInspection, QcMetric } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { nextDocNumber } from "./doc-number.js";
import { post } from "./stock-ledger.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

/** Default density tolerance (± kg/m³) when the item master doesn't set one. */
export const DEFAULT_DENSITY_TOLERANCE = new Decimal(2);

export class QcValidationError extends Error {
  override name = "QcValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure helpers --------------------------------------------------------------------

/** Measured − target density (signed). A KPI, not an error to reconcile away (CLAUDE.md 4). */
export function densityVariance(measured: DecimalInput, target: DecimalInput): Decimal {
  return new Decimal(measured).minus(target);
}

/** True when |measured − target| ≤ tolerance. Pure. */
export function withinDensityTolerance(
  measured: DecimalInput,
  target: DecimalInput,
  tolerance: DecimalInput,
): boolean {
  return densityVariance(measured, target).abs().lte(new Decimal(tolerance));
}

/** Validate a passed/failed split against the received quantity for a disposition. Pure. */
export function validSplit(
  qtyReceived: DecimalInput,
  passed: DecimalInput,
  failed: DecimalInput,
  result: "PASS" | "FAIL" | "PARTIAL",
): boolean {
  const total = new Decimal(qtyReceived);
  const p = new Decimal(passed);
  const f = new Decimal(failed);
  if (p.lt(0) || f.lt(0) || !p.plus(f).eq(total)) return false;
  if (result === "PASS") return f.isZero() && p.eq(total);
  if (result === "FAIL") return p.isZero() && f.eq(total);
  return p.gt(0) && f.gt(0); // PARTIAL: both sides non-zero
}

// --- location resolution -------------------------------------------------------------

async function resolveFreeLocation(
  tx: Tx,
  companyId: string,
  toLocationId?: string | null,
) {
  if (toLocationId) {
    const loc = await tx.location.findFirst({
      where: { id: toLocationId, companyId, isQcHold: false, isReject: false },
    });
    if (!loc)
      throw new QcValidationError(["the chosen destination is not a free location"]);
    return loc;
  }
  const loc = await tx.location.findFirst({
    where: { companyId, isQcHold: false, isReject: false },
    orderBy: { code: "asc" },
  });
  if (!loc)
    throw new QcValidationError(["no free location configured to release stock into"]);
  return loc;
}

async function resolveRejectLocation(tx: Tx, companyId: string) {
  const loc = await tx.location.findFirst({
    where: { companyId, isReject: true },
    orderBy: { code: "asc" },
  });
  if (!loc)
    throw new QcValidationError([
      "no reject location configured — create one (isReject)",
    ]);
  return loc;
}

// --- readings ------------------------------------------------------------------------

export interface QcReadingInput {
  metric: QcMetric;
  value?: DecimalInput | null;
  uom?: string | null;
  withinSpec?: boolean;
}

function readingData(readings: QcReadingInput[] | undefined) {
  return (readings ?? []).map((r) => ({
    metric: r.metric,
    value: r.value != null && r.value !== "" ? new Decimal(r.value).toString() : null,
    uom: r.uom ?? null,
    withinSpec: r.withinSpec ?? true,
  }));
}

// --- inspect a GRN line (incoming RM) ------------------------------------------------

export interface InspectGrnLineInput {
  result: "PASS" | "FAIL" | "PARTIAL";
  /** Required for PARTIAL — the accepted quantity; failed is the remainder. */
  qtyPassed?: DecimalInput;
  toLocationId?: string | null;
  remarks?: string | null;
  readings?: QcReadingInput[];
}

/**
 * Disposition an incoming GRN line: pass transfers the accepted quantity from QC-hold to a
 * free location (reason QC_PASS); fail routes it to the reject location (QC_FAIL); partial
 * splits both. Every leg posts through S3 and audits.
 */
export async function inspectGrnLine(
  tx: Tx,
  actor: Actor,
  grnLineId: string,
  input: InspectGrnLineInput,
): Promise<QcInspection> {
  requireAccess(actor, "QC", "write");
  const line = await tx.goodsReceiptLine.findFirst({
    where: { id: grnLineId, grn: { companyId: actor.companyId } },
    include: { grn: true, item: true },
  });
  if (!line) throw new AuthzError("GRN line not found");
  if (line.grn.status !== "POSTED") {
    throw new QcValidationError([`GRN ${line.grn.docNo} is ${line.grn.status}`]);
  }
  if (line.qcStatus !== "PENDING") {
    throw new QcValidationError(["this GRN line has already been inspected"]);
  }

  const received = new Decimal(line.qtyReceived.toString());
  const passed =
    input.result === "PASS"
      ? received
      : input.result === "FAIL"
        ? new Decimal(0)
        : new Decimal(input.qtyPassed ?? 0);
  const failed = received.minus(passed);
  if (!validSplit(received, passed, failed, input.result)) {
    throw new QcValidationError([
      `invalid split for ${input.result}: received ${received}, passed ${passed}`,
    ]);
  }

  // Move stock out of the QC-hold location: accepted → free, rejected → reject.
  if (passed.gt(0)) {
    const free = await resolveFreeLocation(tx, actor.companyId, input.toLocationId);
    await post(tx, {
      grain: "BULK",
      direction: "OUT",
      companyId: actor.companyId,
      itemId: line.itemId,
      locationId: line.locationId,
      qtyBase: passed.toString(),
      reason: "QC_PASS",
      refType: "QcInspection",
      refId: grnLineId,
      actorUserId: actor.userId,
    });
    await post(tx, {
      grain: "BULK",
      direction: "IN",
      companyId: actor.companyId,
      itemId: line.itemId,
      locationId: free.id,
      qtyBase: passed.toString(),
      reason: "QC_PASS",
      refType: "QcInspection",
      refId: grnLineId,
      actorUserId: actor.userId,
    });
  }
  if (failed.gt(0)) {
    const reject = await resolveRejectLocation(tx, actor.companyId);
    await post(tx, {
      grain: "BULK",
      direction: "OUT",
      companyId: actor.companyId,
      itemId: line.itemId,
      locationId: line.locationId,
      qtyBase: failed.toString(),
      reason: "QC_FAIL",
      refType: "QcInspection",
      refId: grnLineId,
      actorUserId: actor.userId,
    });
    await post(tx, {
      grain: "BULK",
      direction: "IN",
      companyId: actor.companyId,
      itemId: line.itemId,
      locationId: reject.id,
      qtyBase: failed.toString(),
      reason: "QC_FAIL",
      refType: "QcInspection",
      refId: grnLineId,
      actorUserId: actor.userId,
    });
  }

  const qcStatus =
    input.result === "PASS" ? "PASSED" : input.result === "FAIL" ? "FAILED" : "PARTIAL";
  await tx.goodsReceiptLine.update({
    where: { id: grnLineId },
    data: { qcStatus, qtyAccepted: passed.toString() },
  });

  const inspection = await createInspection(tx, actor, {
    refType: "GRN_LINE",
    refId: grnLineId,
    itemId: line.itemId,
    result: input.result,
    qtyPassed: passed,
    qtyFailed: failed,
    remarks: input.remarks ?? null,
    readings: input.readings,
  });
  return inspection;
}

// --- inspect a lot's rolls (finished goods) ------------------------------------------

export interface InspectLotInput {
  /** Roll ids to fail; every other pending roll on the lot passes (per-lot sign-off default). */
  failedRollIds?: string[];
  remarks?: string | null;
  /** Instant used to decide whether a passed roll is also aged (and so becomes AVAILABLE). */
  asOf?: Date;
}
export interface InspectLotResult {
  inspected: number;
  passed: number;
  failed: number;
  releasedToAvailable: number;
}

/**
 * Per-lot QC sign-off: pass every CURING roll pending QC, except those explicitly failed.
 * A passed roll clears the QC gate and, if already aged (S12), flips to AVAILABLE; a failed
 * roll goes REJECTED. Each roll gets its own inspection with a density reading + variance.
 */
export async function inspectLot(
  tx: Tx,
  actor: Actor,
  lotId: string,
  input: InspectLotInput = {},
): Promise<InspectLotResult> {
  requireAccess(actor, "QC", "write");
  const lot = await tx.lot.findFirst({
    where: { id: lotId, companyId: actor.companyId },
    include: { rolls: { include: { item: true } } },
  });
  if (!lot) throw new AuthzError("lot not found");

  const pending = lot.rolls.filter(
    (r) => r.qcStatus === "PENDING" && r.state === "CURING",
  );
  if (pending.length === 0) {
    throw new QcValidationError(["no rolls on this lot are pending QC"]);
  }
  const failSet = new Set(input.failedRollIds ?? []);
  const asOf = input.asOf ?? new Date();
  const result: InspectLotResult = {
    inspected: 0,
    passed: 0,
    failed: 0,
    releasedToAvailable: 0,
  };

  for (const roll of pending) {
    const target = roll.item.density_kg_m3;
    const measured = new Decimal(roll.densityKgM3.toString());
    const tolerance = roll.item.densityTolerance
      ? new Decimal(roll.item.densityTolerance.toString())
      : DEFAULT_DENSITY_TOLERANCE;
    const within = target
      ? withinDensityTolerance(measured, target.toString(), tolerance)
      : true;
    const densityReading: QcReadingInput = {
      metric: "DENSITY",
      value: measured.toString(),
      uom: "kg/m3",
      withinSpec: within,
    };

    if (failSet.has(roll.id)) {
      await tx.roll.update({
        where: { id: roll.id },
        data: { qcStatus: "FAILED", qcInspectedAt: asOf, state: "REJECTED" },
      });
      await writeAudit(tx, {
        companyId: actor.companyId,
        entity: "Roll",
        entityId: roll.id,
        action: "QC_FAIL",
        actorUserId: actor.userId,
        before: { state: "CURING", qcStatus: "PENDING" },
        after: { state: "REJECTED", qcStatus: "FAILED" },
      });
      await createInspection(tx, actor, {
        refType: "ROLL",
        refId: roll.id,
        itemId: roll.itemId,
        result: "FAIL",
        qtyPassed: new Decimal(0),
        qtyFailed: new Decimal(roll.qtyKgActual.toString()),
        remarks: input.remarks ?? null,
        readings: [densityReading],
      });
      result.failed += 1;
    } else {
      // Pass clears the QC gate; if the roll is also aged, it becomes AVAILABLE now.
      const aged =
        roll.agingReadyDate != null && roll.agingReadyDate.getTime() <= asOf.getTime();
      const newState = aged ? "AVAILABLE" : "CURING";
      await tx.roll.update({
        where: { id: roll.id },
        data: { qcStatus: "PASSED", qcInspectedAt: asOf, state: newState },
      });
      await writeAudit(tx, {
        companyId: actor.companyId,
        entity: "Roll",
        entityId: roll.id,
        action: "QC_PASS",
        actorUserId: actor.userId,
        before: { state: "CURING", qcStatus: "PENDING" },
        after: {
          state: newState,
          qcStatus: "PASSED",
          densityVariance: densityVariance(
            measured,
            target?.toString() ?? measured,
          ).toString(),
        },
      });
      await createInspection(tx, actor, {
        refType: "ROLL",
        refId: roll.id,
        itemId: roll.itemId,
        result: "PASS",
        qtyPassed: new Decimal(roll.qtyKgActual.toString()),
        qtyFailed: new Decimal(0),
        remarks: input.remarks ?? null,
        readings: [densityReading],
      });
      result.passed += 1;
      if (aged) result.releasedToAvailable += 1;
    }
    result.inspected += 1;
  }
  return result;
}

// --- inspection record ---------------------------------------------------------------

interface CreateInspectionInput {
  refType: "GRN_LINE" | "ROLL";
  refId: string;
  itemId: string;
  result: "PASS" | "FAIL" | "PARTIAL";
  qtyPassed: Decimal;
  qtyFailed: Decimal;
  remarks?: string | null;
  readings?: QcReadingInput[];
}

async function createInspection(
  tx: Tx,
  actor: Actor,
  input: CreateInspectionInput,
): Promise<QcInspection> {
  const docNo = await nextDocNumber(tx, actor.companyId, "QC_INSPECTION", {
    prefix: "QC",
  });
  const inspection = await tx.qcInspection.create({
    data: {
      companyId: actor.companyId,
      docNo,
      refType: input.refType,
      refId: input.refId,
      itemId: input.itemId,
      result: input.result,
      qtyPassed: input.qtyPassed.toString(),
      qtyFailed: input.qtyFailed.toString(),
      remarks: input.remarks ?? null,
      createdById: actor.userId,
      readings: { create: readingData(input.readings) },
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "QcInspection",
    entityId: inspection.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: {
      docNo: inspection.docNo,
      refType: input.refType,
      refId: input.refId,
      result: input.result,
    },
  });
  return inspection;
}

// --- queue queries (for the UI) ------------------------------------------------------

/** GRN lines still on QC hold, oldest first. */
export function grnLinesPendingQc(db: Tx, companyId: string) {
  return db.goodsReceiptLine.findMany({
    where: { qcStatus: "PENDING", grn: { companyId, status: "POSTED" } },
    orderBy: { grn: { receivedAt: "asc" } },
    include: { item: true, grn: { include: { supplier: true } }, location: true },
    take: 200,
  });
}

/** Rolls awaiting QC sign-off (curing, QC pending). */
export function rollsPendingQc(db: Tx, companyId: string) {
  return db.roll.findMany({
    where: { companyId, qcStatus: "PENDING", state: "CURING" },
    orderBy: { rollNo: "asc" },
    include: { item: true, lot: true },
    take: 500,
  });
}
