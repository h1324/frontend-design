// lib/reorder.ts — predictive reorder (spec S28).
// Turn consumption history into a defensible reorder point and a concrete purchase suggestion,
// with a human always in the loop. The reorder math is pure and transparent (no opaque model):
// reorderPoint = avgDailyConsumption × leadTimeDays + safetyStock, and every input to a
// suggestion is snapshotted on the ReorderSuggestion row so a buyer can see *why*. Suggestions
// are advisory — the module can pre-fill a DRAFT PO (S14) but never confirms or sends one.
//
// Quantities are Decimal in the item's base UOM; money is paise (BigInt). STORES-write gated,
// audited; threshold changes record their previous values.

import type { Prisma, ReorderSuggestion } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { writeAudit } from "./audit.js";
import { createPO } from "./purchasing.js";

type Tx = Prisma.TransactionClient;

/** Default trailing window for the consumption average (spec S28 rule 4, tunable per item class). */
export const DEFAULT_WINDOW_DAYS = 90;

/** Item types the scan considers. RM/consumables/packing are the brief's priority; finished-goods
 *  make-to-stock replenishment is deliberately out of v1 (spec S28 open question, default off). */
export const REORDER_ITEM_TYPES = ["RAW_MATERIAL", "CONSUMABLE", "PACKING"] as const;

export class ReorderError extends Error {
  override name = "ReorderError";
}

// --- pure math -----------------------------------------------------------------------
//
// The forecast is isolated behind forecastDailyDemand() — the *only* place a demand model lives.
// v1 is a trailing moving average (transparent, unit-testable at boundaries). A richer model
// (trend/seasonality) can drop in here later without moving the reorder-point formula.

export type ForecastMethod = "MOVING_AVERAGE";

export interface ForecastInput {
  /** Total quantity consumed across the whole window (base UOM). */
  totalConsumed: DecimalInput;
  /** Length of the trailing window, in days. Must be > 0. */
  windowDays: number;
  method?: ForecastMethod;
}

/** Average daily demand over the window. The seam: swap the method, keep the formula.
 *  Moving average = total consumed ÷ window length, so zero-consumption gaps simply pull the
 *  average down (the denominator is the fixed window, not the count of active days) — robust to
 *  quiet spells without special-casing them. Pure. */
export function forecastDailyDemand(input: ForecastInput): Decimal {
  const windowDays = input.windowDays;
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new ReorderError("windowDays must be a positive number");
  }
  const total = new Decimal(input.totalConsumed);
  if (total.lt(0)) throw new ReorderError("totalConsumed cannot be negative");
  switch (input.method ?? "MOVING_AVERAGE") {
    case "MOVING_AVERAGE":
      return total.div(windowDays);
  }
}

/** Reorder point = lead-time demand + safety stock (spec S28 rule 2). Pure. */
export function reorderPoint(
  avgDailyConsumption: DecimalInput,
  leadTimeDays: number,
  safetyStock: DecimalInput = "0",
): Decimal {
  if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) {
    throw new ReorderError("leadTimeDays must be zero or more");
  }
  return new Decimal(avgDailyConsumption).times(leadTimeDays).plus(safetyStock);
}

export interface SuggestedQtyInput {
  onHand: DecimalInput;
  reorderPoint: DecimalInput;
  avgDailyConsumption: DecimalInput;
  leadTimeDays: number;
  /** Supplier minimum order quantity, if known — the suggestion is floored to it. */
  moq?: DecimalInput | null;
}

/** Suggested purchase quantity: buy back up to the reorder point *plus* one lead-time of cover,
 *  less what is already on hand; never negative; floored at a supplier MOQ when known (spec S28
 *  rule 2). Pure. */
export function suggestedQty(input: SuggestedQtyInput): Decimal {
  const cover = new Decimal(input.avgDailyConsumption).times(input.leadTimeDays);
  const target = new Decimal(input.reorderPoint).plus(cover);
  const raw = target.minus(input.onHand);
  if (raw.lte(0)) return new Decimal(0);
  if (input.moq != null && input.moq !== "") {
    const moq = new Decimal(input.moq);
    if (moq.gt(0) && raw.lt(moq)) return moq;
  }
  return raw;
}

/** Days of cover remaining at current consumption. Null when consumption is zero (infinite
 *  cover — not a stockout risk). Pure. */
export function daysOfCover(
  onHand: DecimalInput,
  avgDailyConsumption: DecimalInput,
): Decimal | null {
  const avg = new Decimal(avgDailyConsumption);
  if (avg.lte(0)) return null;
  return new Decimal(onHand).div(avg);
}

/** Safety stock expressed as N days of cover at current consumption — the helper offered for
 *  operators who think in days rather than absolute quantity (spec S28 open question). Pure. */
export function safetyStockFromDaysOfCover(
  avgDailyConsumption: DecimalInput,
  days: number,
): Decimal {
  if (!Number.isFinite(days) || days < 0) {
    throw new ReorderError("days must be zero or more");
  }
  return new Decimal(avgDailyConsumption).times(days);
}

// --- read services -------------------------------------------------------------------

/** Available on-hand for reorder purposes: sum of stock balances, *excluding* QC-hold and reject
 *  locations so a reorder point is neither tripped nor masked by stock that cannot be used
 *  (spec S28 rule 3). Base UOM. */
export async function availableOnHand(
  tx: Tx,
  companyId: string,
  itemId: string,
): Promise<Decimal> {
  const balances = await tx.stockBalance.findMany({
    where: {
      companyId,
      itemId,
      location: { isQcHold: false, isReject: false },
    },
    select: { qtyBase: true },
  });
  return balances.reduce((sum, b) => sum.plus(b.qtyBase.toString()), new Decimal(0));
}

/** Total quantity of an item consumed (issued) within the trailing window. Covers both direct RM
 *  issues (S9) and batch consumption (S10) — both post MaterialIssue rows — over POSTED issues
 *  only. Base UOM. */
export async function consumptionInWindow(
  tx: Tx,
  companyId: string,
  itemId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
  asOf: Date = new Date(),
): Promise<Decimal> {
  const from = new Date(asOf.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const lines = await tx.materialIssueLine.findMany({
    where: {
      itemId,
      issue: { companyId, status: "POSTED", issuedAt: { gte: from, lte: asOf } },
    },
    select: { qtyBase: true },
  });
  return lines.reduce((sum, l) => sum.plus(l.qtyBase.toString()), new Decimal(0));
}

/** The supplier most recently ordered from for this item (from PO history, spec S6/S14), used to
 *  pre-fill the draft PO. Null when the item has never been purchased. */
export async function preferredSupplierFor(
  tx: Tx,
  companyId: string,
  itemId: string,
): Promise<string | null> {
  const lastLine = await tx.purchaseOrderLine.findFirst({
    where: { itemId, po: { companyId, status: { not: "CANCELLED" } } },
    orderBy: { po: { orderDate: "desc" } },
    select: { po: { select: { supplierId: true } } },
  });
  return lastLine?.po.supplierId ?? null;
}

// --- reorder scan --------------------------------------------------------------------

export interface ReorderScanOptions {
  /** Trailing consumption window in days. Default 90. */
  windowDays?: number;
  /** As-of instant for the scan (window end + snapshot time). Default now. */
  asOf?: Date;
  method?: ForecastMethod;
}

export interface ReorderLine {
  itemId: string;
  code: string;
  name: string;
  uomBase: string;
  onHand: Decimal;
  avgDailyConsumption: Decimal;
  effectiveReorderPoint: Decimal;
  daysOfCover: Decimal | null;
  suggestedQty: Decimal;
  preferredSupplierId: string | null;
  belowPoint: boolean;
}

/** Compute the live reorder picture for one item without writing anything — the transparent
 *  calculation the board and the scan both rely on. Returns null for items not configured for
 *  reorder (no lead time and no manual reorder point). */
async function computeReorderLine(
  tx: Tx,
  companyId: string,
  item: {
    id: string;
    code: string;
    name: string;
    uomBase: string;
    leadTimeDays: number | null;
    safetyStock: Prisma.Decimal | null;
    reorderPoint: Prisma.Decimal | null;
  },
  windowDays: number,
  asOf: Date,
  method?: ForecastMethod,
): Promise<ReorderLine | null> {
  const total = await consumptionInWindow(tx, companyId, item.id, windowDays, asOf);
  const avg = forecastDailyDemand({ totalConsumed: total, windowDays, method });

  // Effective reorder point: computed live from consumption when a lead time is configured,
  // otherwise the manually-set threshold. Neither present → the item opts out of reorder.
  const computed =
    item.leadTimeDays != null
      ? reorderPoint(avg, item.leadTimeDays, item.safetyStock?.toString() ?? "0")
      : null;
  const manual =
    item.reorderPoint != null ? new Decimal(item.reorderPoint.toString()) : null;
  const effective = computed ?? manual;
  if (effective == null) return null;

  const onHand = await availableOnHand(tx, companyId, item.id);
  const leadTimeDays = item.leadTimeDays ?? 0;
  const sugg = suggestedQty({
    onHand,
    reorderPoint: effective,
    avgDailyConsumption: avg,
    leadTimeDays,
  });
  const preferredSupplierId = await preferredSupplierFor(tx, companyId, item.id);

  return {
    itemId: item.id,
    code: item.code,
    name: item.name,
    uomBase: item.uomBase,
    onHand,
    avgDailyConsumption: avg,
    effectiveReorderPoint: effective,
    daysOfCover: daysOfCover(onHand, avg),
    suggestedQty: sugg,
    preferredSupplierId,
    belowPoint: onHand.lte(effective),
  };
}

/** The full reorder picture across all AUTO_SUGGEST RM/consumable/packing items, computed live —
 *  read-only, safe to render on demand. Rows are sorted most-urgent first (lowest days of cover). */
export async function reorderBoard(
  tx: Tx,
  actor: Actor,
  opts: ReorderScanOptions = {},
): Promise<ReorderLine[]> {
  requireAccess(actor, "STORES", "read");
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const asOf = opts.asOf ?? new Date();
  const items = await tx.item.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      reorderPolicy: "AUTO_SUGGEST",
      type: { in: [...REORDER_ITEM_TYPES] },
    },
    orderBy: { code: "asc" },
  });
  const lines: ReorderLine[] = [];
  for (const it of items) {
    const line = await computeReorderLine(
      tx,
      actor.companyId,
      it,
      windowDays,
      asOf,
      opts.method,
    );
    if (line) lines.push(line);
  }
  // Most urgent first: below-point before covered, then by ascending days of cover (null = safe).
  lines.sort((a, b) => {
    if (a.belowPoint !== b.belowPoint) return a.belowPoint ? -1 : 1;
    const da = a.daysOfCover?.toNumber() ?? Infinity;
    const db = b.daysOfCover?.toNumber() ?? Infinity;
    return da - db;
  });
  return lines;
}

/** Materialise reorder suggestions: for every configured item at/below its reorder point, expire
 *  any prior OPEN suggestion and write a fresh OPEN snapshot capturing the inputs it was computed
 *  from (spec S28 rules 2, 4; acceptance 2). Returns the suggestions created. Advisory only —
 *  nothing is ordered. STORES-write. */
export async function runReorderScan(
  tx: Tx,
  actor: Actor,
  opts: ReorderScanOptions = {},
): Promise<ReorderSuggestion[]> {
  requireAccess(actor, "STORES", "write");
  const asOf = opts.asOf ?? new Date();
  const board = await reorderBoard(tx, actor, { ...opts, asOf });
  const created: ReorderSuggestion[] = [];

  for (const line of board) {
    if (!line.belowPoint) continue;
    // Supersede any live suggestion for this item before writing the fresh one.
    await tx.reorderSuggestion.updateMany({
      where: { companyId: actor.companyId, itemId: line.itemId, status: "OPEN" },
      data: { status: "EXPIRED" },
    });
    const suggestion = await tx.reorderSuggestion.create({
      data: {
        companyId: actor.companyId,
        itemId: line.itemId,
        asOf,
        onHandQty: line.onHand.toString(),
        reorderPoint: line.effectiveReorderPoint.toString(),
        avgDailyConsumption: line.avgDailyConsumption.toDecimalPlaces(4).toString(),
        suggestedQty: line.suggestedQty.toString(),
        preferredSupplierId: line.preferredSupplierId,
        status: "OPEN",
        generatedBy: actor.userId,
      },
    });
    await writeAudit(tx, {
      companyId: actor.companyId,
      entity: "ReorderSuggestion",
      entityId: suggestion.id,
      action: "CREATE",
      actorUserId: actor.userId,
      after: {
        itemId: line.itemId,
        onHandQty: suggestion.onHandQty.toString(),
        reorderPoint: suggestion.reorderPoint.toString(),
        suggestedQty: suggestion.suggestedQty.toString(),
      },
    });
    created.push(suggestion);
  }
  return created;
}

// --- act on a suggestion -------------------------------------------------------------

/** Pre-fill a DRAFT purchase order (S14) from an OPEN suggestion: one line for the suggested
 *  quantity at the item's moving-average cost (indicative — the value of record comes at
 *  GRN/invoice), to the preferred supplier. Links resultPoId and flips the suggestion to
 *  PO_DRAFTED. Never confirms or sends (spec S28 rule 1, acceptance 3). STORES-write. */
export async function draftPoFromSuggestion(
  tx: Tx,
  actor: Actor,
  suggestionId: string,
): Promise<{ suggestion: ReorderSuggestion; poId: string }> {
  requireAccess(actor, "STORES", "write");
  const suggestion = await tx.reorderSuggestion.findFirst({
    where: { id: suggestionId, companyId: actor.companyId },
  });
  if (!suggestion) throw new AuthzError("reorder suggestion not found");
  if (suggestion.status !== "OPEN") {
    throw new ReorderError(`suggestion is ${suggestion.status}, not OPEN`);
  }
  if (!suggestion.preferredSupplierId) {
    throw new ReorderError(
      "no preferred supplier on this suggestion — raise the PO manually and pick a supplier",
    );
  }
  const item = await tx.item.findFirst({
    where: { id: suggestion.itemId, companyId: actor.companyId },
  });
  if (!item) throw new ReorderError("item not found");

  const po = await createPO(tx, actor, {
    supplierId: suggestion.preferredSupplierId,
    status: "DRAFT",
    notes: `Auto-drafted from reorder suggestion (${item.code})`,
    lines: [
      {
        itemId: suggestion.itemId,
        qtyOrdered: suggestion.suggestedQty.toString(),
        ratePaise: Number(item.movingAvgCostPaise),
      },
    ],
  });

  const updated = await tx.reorderSuggestion.update({
    where: { id: suggestionId },
    data: { status: "PO_DRAFTED", resultPoId: po.id },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "ReorderSuggestion",
    entityId: suggestionId,
    action: "PO_DRAFTED",
    actorUserId: actor.userId,
    before: { status: "OPEN" },
    after: { status: "PO_DRAFTED", resultPoId: po.id },
  });
  return { suggestion: updated, poId: po.id };
}

/** Dismiss an OPEN suggestion with a required reason (spec S28 public surface). STORES-write. */
export async function dismissSuggestion(
  tx: Tx,
  actor: Actor,
  suggestionId: string,
  reason: string,
): Promise<ReorderSuggestion> {
  requireAccess(actor, "STORES", "write");
  if (!reason?.trim())
    throw new ReorderError("a reason is required to dismiss a suggestion");
  const suggestion = await tx.reorderSuggestion.findFirst({
    where: { id: suggestionId, companyId: actor.companyId },
  });
  if (!suggestion) throw new AuthzError("reorder suggestion not found");
  if (suggestion.status !== "OPEN") {
    throw new ReorderError(`suggestion is ${suggestion.status}, not OPEN`);
  }
  const updated = await tx.reorderSuggestion.update({
    where: { id: suggestionId },
    data: { status: "DISMISSED", dismissedReason: reason.trim() },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "ReorderSuggestion",
    entityId: suggestionId,
    action: "DISMISS",
    actorUserId: actor.userId,
    before: { status: "OPEN" },
    after: { status: "DISMISSED", reason: reason.trim() },
  });
  return updated;
}

// --- thresholds ----------------------------------------------------------------------

export interface ReorderPolicyPatch {
  reorderPoint?: DecimalInput | null;
  safetyStock?: DecimalInput | null;
  leadTimeDays?: number | null;
  reorderPolicy?: "MANUAL" | "AUTO_SUGGEST";
}

/** Edit an item's reorder thresholds (spec S28 rule 5). Audits the *previous* values so a change
 *  to a reorder point/safety stock/lead time is traceable. STORES-write. */
export async function setReorderPolicy(
  tx: Tx,
  actor: Actor,
  itemId: string,
  patch: ReorderPolicyPatch,
): Promise<void> {
  requireAccess(actor, "STORES", "write");
  const item = await tx.item.findFirst({
    where: { id: itemId, companyId: actor.companyId },
  });
  if (!item) throw new AuthzError("item not found");

  if (patch.leadTimeDays != null && patch.leadTimeDays < 0) {
    throw new ReorderError("leadTimeDays must be zero or more");
  }

  await tx.item.update({
    where: { id: itemId },
    data: {
      ...(patch.reorderPoint !== undefined
        ? { reorderPoint: patch.reorderPoint == null ? null : String(patch.reorderPoint) }
        : {}),
      ...(patch.safetyStock !== undefined
        ? { safetyStock: patch.safetyStock == null ? null : String(patch.safetyStock) }
        : {}),
      ...(patch.leadTimeDays !== undefined ? { leadTimeDays: patch.leadTimeDays } : {}),
      ...(patch.reorderPolicy !== undefined
        ? { reorderPolicy: patch.reorderPolicy }
        : {}),
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Item",
    entityId: itemId,
    action: "REORDER_POLICY",
    actorUserId: actor.userId,
    before: {
      reorderPoint: item.reorderPoint?.toString() ?? null,
      safetyStock: item.safetyStock?.toString() ?? null,
      leadTimeDays: item.leadTimeDays,
      reorderPolicy: item.reorderPolicy,
    },
    after: {
      reorderPoint:
        patch.reorderPoint !== undefined
          ? patch.reorderPoint == null
            ? null
            : String(patch.reorderPoint)
          : (item.reorderPoint?.toString() ?? null),
      safetyStock:
        patch.safetyStock !== undefined
          ? patch.safetyStock == null
            ? null
            : String(patch.safetyStock)
          : (item.safetyStock?.toString() ?? null),
      leadTimeDays:
        patch.leadTimeDays !== undefined ? patch.leadTimeDays : item.leadTimeDays,
      reorderPolicy: patch.reorderPolicy ?? item.reorderPolicy,
    },
  });
}
