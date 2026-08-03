// lib/production.ts — production batch (lot) entry (spec S10).
// A lot captures one extrusion run: RM consumed (via S9 issues), rolls produced (via S3
// receiveRoll), scrap/trim, and downtime. Regrind %, yield and material balance are
// derived. Pure metric helpers are unit-testable; the service enforces PRODUCTION-write,
// writes audit rows, and keeps a CLOSED lot immutable except by cancellation.

import type { Lot, Prisma } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { nextDocNumber } from "./doc-number.js";
import { receiveRoll } from "./stock-ledger.js";
import { reverse } from "./stock-ledger.js";
import { resolveItemAging } from "./items.js";
import { writeAudit } from "./audit.js";
import type { Dimensions } from "./uom.js";

type Tx = Prisma.TransactionClient;

const MS_PER_DAY = 86_400_000;

export class ProductionValidationError extends Error {
  override name = "ProductionValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure metric helpers -------------------------------------------------------------

/** Regrind percentage of an issue set = regrind qty ÷ total qty × 100. Pure. */
export function computeRegrindPct(
  lines: { qtyBase: DecimalInput; isRegrind: boolean }[],
): Decimal {
  let total = new Decimal(0);
  let regrind = new Decimal(0);
  for (const l of lines) {
    const q = new Decimal(l.qtyBase);
    total = total.plus(q);
    if (l.isRegrind) regrind = regrind.plus(q);
  }
  return total.isZero() ? new Decimal(0) : regrind.div(total).times(100);
}

/** Material yield = output ÷ input × 100. Pure. */
export function computeYieldPct(inputKg: DecimalInput, outputKg: DecimalInput): Decimal {
  const input = new Decimal(inputKg);
  return input.isZero() ? new Decimal(0) : new Decimal(outputKg).div(input).times(100);
}

/** input − (output + scrap + trim). A KPI, not an error to reconcile away. Pure. */
export function materialBalance(
  inputKg: DecimalInput,
  outputKg: DecimalInput,
  scrapKg: DecimalInput,
  trimKg: DecimalInput,
): Decimal {
  return new Decimal(inputKg).minus(outputKg).minus(scrapKg).minus(trimKg);
}

/** Aging-ready date = production date + aging days. Pure. */
export function agingReadyDate(productionDate: Date, agingDays: number): Date {
  return new Date(productionDate.getTime() + agingDays * MS_PER_DAY);
}

// --- open / downtime -----------------------------------------------------------------

export interface OpenLotInput {
  machineId: string;
  shiftId: string;
  operatorId: string;
  targetItemId: string;
  productionDate?: Date;
  startAt?: Date;
}

export async function openLot(tx: Tx, actor: Actor, input: OpenLotInput): Promise<Lot> {
  requireAccess(actor, "PRODUCTION", "write");
  const errors: string[] = [];
  if (!input.machineId) errors.push("machine is required");
  if (!input.shiftId) errors.push("shift is required");
  if (!input.operatorId) errors.push("operator is required");
  if (!input.targetItemId) errors.push("target item is required");
  if (errors.length) throw new ProductionValidationError(errors);

  const productionDate = input.productionDate ?? new Date();
  const lotNo = await nextDocNumber(tx, actor.companyId, "LOT", {
    prefix: "LOT",
    now: productionDate,
  });
  const lot = await tx.lot.create({
    data: {
      companyId: actor.companyId,
      lotNo,
      machineId: input.machineId,
      shiftId: input.shiftId,
      operatorId: input.operatorId,
      targetItemId: input.targetItemId,
      productionDate,
      startAt: input.startAt ?? productionDate,
      createdById: actor.userId,
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Lot",
    entityId: lot.id,
    action: "OPEN",
    actorUserId: actor.userId,
    after: { lotNo: lot.lotNo, targetItemId: lot.targetItemId },
  });
  return lot;
}

async function loadOpenLot(tx: Tx, actor: Actor, lotId: string): Promise<Lot> {
  const lot = await tx.lot.findFirst({
    where: { id: lotId, companyId: actor.companyId },
  });
  if (!lot) throw new AuthzError("lot not found");
  if (lot.status !== "OPEN") {
    throw new ProductionValidationError([`lot ${lot.lotNo} is ${lot.status}, not OPEN`]);
  }
  return lot;
}

export async function addDowntime(
  tx: Tx,
  actor: Actor,
  lotId: string,
  input: { reasonId: string; minutes: number; note?: string | null },
): Promise<void> {
  requireAccess(actor, "PRODUCTION", "write");
  await loadOpenLot(tx, actor, lotId);
  if (!input.reasonId) throw new ProductionValidationError(["reason is required"]);
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new ProductionValidationError(["minutes must be a whole number > 0"]);
  }
  const log = await tx.downtimeLog.create({
    data: {
      lotId,
      reasonId: input.reasonId,
      minutes: input.minutes,
      note: input.note ?? null,
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "DowntimeLog",
    entityId: log.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: { lotId, reasonId: input.reasonId, minutes: input.minutes },
  });
}

// --- close ---------------------------------------------------------------------------

export interface OutputRollInput {
  locationId: string;
  dimensions: Dimensions;
  actualKg: DecimalInput;
  /** Defaults to the lot's target item. */
  itemId?: string;
}
export interface CloseLotInput {
  rolls: OutputRollInput[];
  scrapKg?: DecimalInput;
  trimKg?: DecimalInput;
  energyKwh?: DecimalInput | null;
  endAt?: Date;
}

/**
 * Close a lot: create its output rolls in CURING (each with an aging-ready date and a
 * SERIAL IN posting), compute output kg and regrind %, and finalize the lot. A CLOSED lot
 * is immutable except by cancellation.
 */
export async function closeLot(
  tx: Tx,
  actor: Actor,
  lotId: string,
  input: CloseLotInput,
): Promise<Lot> {
  requireAccess(actor, "PRODUCTION", "write");
  const lot = await loadOpenLot(tx, actor, lotId);
  if (!input.rolls?.length) {
    throw new ProductionValidationError(["at least one output roll is required"]);
  }

  let outputKg = new Decimal(0);
  for (const spec of input.rolls) {
    const itemId = spec.itemId ?? lot.targetItemId;
    const agingDays = await resolveItemAging(tx, itemId);
    await receiveRoll(tx, {
      companyId: actor.companyId,
      itemId,
      locationId: spec.locationId,
      dimensions: spec.dimensions,
      actualKg: spec.actualKg,
      initialState: "CURING",
      agingReadyDate: agingReadyDate(lot.productionDate, agingDays),
      reason: "PRODUCTION",
      lotId: lot.id,
      refType: "Lot",
      refId: lot.id,
      actorUserId: actor.userId,
    });
    outputKg = outputKg.plus(new Decimal(spec.actualKg));
  }

  // Regrind % from the RM issued to this lot.
  const issues = await tx.materialIssue.findMany({
    where: { lotId: lot.id, status: "POSTED" },
    include: { lines: true },
  });
  const issueLines = issues.flatMap((i) => i.lines);
  const regrindPct = computeRegrindPct(
    issueLines.map((l) => ({ qtyBase: l.qtyBase.toString(), isRegrind: l.isRegrind })),
  );

  const updated = await tx.lot.update({
    where: { id: lot.id },
    data: {
      status: "CLOSED",
      outputKg: outputKg.toString(),
      scrapKg: input.scrapKg != null ? new Decimal(input.scrapKg).toString() : "0",
      trimKg: input.trimKg != null ? new Decimal(input.trimKg).toString() : "0",
      energyKwh:
        input.energyKwh != null && input.energyKwh !== ""
          ? new Decimal(input.energyKwh).toString()
          : null,
      regrindPct: regrindPct.toString(),
      endAt: input.endAt ?? new Date(),
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Lot",
    entityId: lot.id,
    action: "CLOSE",
    actorUserId: actor.userId,
    before: { status: "OPEN" },
    after: { status: "CLOSED", outputKg: outputKg.toString(), rolls: input.rolls.length },
  });
  return updated;
}

// --- cancel --------------------------------------------------------------------------

/** Cancel a lot: reverse its output rolls' stock (and mark them CANCELLED) and reverse the
 *  RM issued to it (material back to stock). Nothing is deleted. */
export async function cancelLot(tx: Tx, actor: Actor, lotId: string): Promise<Lot> {
  requireAccess(actor, "PRODUCTION", "write");
  const lot = await tx.lot.findFirst({
    where: { id: lotId, companyId: actor.companyId },
    include: { rolls: true, materialIssues: { include: { lines: true } } },
  });
  if (!lot) throw new AuthzError("lot not found");
  if (lot.status === "CANCELLED") {
    throw new ProductionValidationError(["lot is already cancelled"]);
  }

  // Reverse each roll's SERIAL IN and mark it CANCELLED.
  for (const roll of lot.rolls) {
    const ins = await tx.stockLedger.findMany({
      where: { rollId: roll.id, grain: "SERIAL", direction: "IN", reason: "PRODUCTION" },
    });
    for (const entry of ins) {
      const alreadyReversed = await tx.stockLedger.findUnique({
        where: { reversesLedgerId: entry.id },
      });
      if (!alreadyReversed) {
        await reverse(tx, entry.id, actor.userId, `lot ${lot.lotNo} cancelled`);
      }
    }
    if (roll.state !== "CANCELLED") {
      await tx.roll.update({ where: { id: roll.id }, data: { state: "CANCELLED" } });
      await writeAudit(tx, {
        companyId: actor.companyId,
        entity: "Roll",
        entityId: roll.id,
        action: "CANCEL",
        actorUserId: actor.userId,
        before: { state: roll.state },
        after: { state: "CANCELLED", lotNo: lot.lotNo },
      });
    }
  }

  // Reverse the RM issued to the lot (adds it back to stock) and mark the issues cancelled.
  for (const issue of lot.materialIssues) {
    if (issue.status !== "POSTED") continue;
    for (const line of issue.lines) {
      if (line.ledgerId) {
        await reverse(tx, line.ledgerId, actor.userId, `lot ${lot.lotNo} cancelled`);
      }
    }
    await tx.materialIssue.update({
      where: { id: issue.id },
      data: { status: "CANCELLED" },
    });
  }

  const updated = await tx.lot.update({
    where: { id: lot.id },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Lot",
    entityId: lot.id,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: lot.status },
    after: { status: "CANCELLED", lotNo: lot.lotNo },
  });
  return updated;
}

// --- metrics (for display) -----------------------------------------------------------

export interface LotMetrics {
  inputKg: Decimal;
  outputKg: Decimal;
  scrapKg: Decimal;
  trimKg: Decimal;
  regrindPct: Decimal;
  yieldPct: Decimal;
  balanceVariance: Decimal;
}

/** Derived metrics for a lot: input (from issues), output/scrap/trim (from the lot),
 *  regrind %, yield %, and material-balance variance. */
export async function lotMetrics(tx: Tx, lotId: string): Promise<LotMetrics> {
  const lot = await tx.lot.findUniqueOrThrow({ where: { id: lotId } });
  const issues = await tx.materialIssue.findMany({
    where: { lotId, status: "POSTED" },
    include: { lines: true },
  });
  const inputKg = issues
    .flatMap((i) => i.lines)
    .reduce((sum, l) => sum.plus(l.qtyBase.toString()), new Decimal(0));

  const outputKg = new Decimal(lot.outputKg.toString());
  const scrapKg = new Decimal(lot.scrapKg.toString());
  const trimKg = new Decimal(lot.trimKg.toString());
  return {
    inputKg,
    outputKg,
    scrapKg,
    trimKg,
    regrindPct: new Decimal(lot.regrindPct.toString()),
    yieldPct: computeYieldPct(inputKg, outputKg),
    balanceVariance: materialBalance(inputKg, outputKg, scrapKg, trimKg),
  };
}
