// lib/landed-cost.ts — landed-cost valuation (spec S20).
// Turn a goods receipt (S15) into a true landed cost per RM unit: supplier rate + its share of
// freight/duty/insurance/other charges, apportioned across the receipt's lines. Maintains a
// moving weighted-average cost per item that production costing (S21) and inventory valuation
// read. All maths on integer paise / Decimal quantities — never float (CLAUDE.md rule 2).
// Cancelling a costed GRN (S15) unwinds its cost via `reverseLandedCost`.

import type { ApportionBasis, ChargeType, GoodsReceipt, Prisma } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

export class LandedCostError extends Error {
  override name = "LandedCostError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure maths ----------------------------------------------------------------------

/**
 * Apportion a charge (total paise) across lines by their weights, returning integer-paise
 * shares that sum **exactly** to the total. Floor each proportional share, then hand the whole
 * rounding remainder to the largest-weight line (spec S20 rule 1). Zero/absent weights split
 * the total equally. Pure.
 */
export function apportion(weights: DecimalInput[], totalPaise: bigint): bigint[] {
  const n = weights.length;
  if (n === 0) return [];
  const total = new Decimal(totalPaise.toString());
  if (total.lte(0)) return weights.map(() => 0n);

  const w = weights.map((x) => new Decimal(x));
  const sum = w.reduce((a, b) => a.plus(b), new Decimal(0));

  const shares: bigint[] = new Array(n).fill(0n);
  let allocated = 0n;
  if (sum.lte(0)) {
    // Equal split: floor(total / n) each, remainder to the first lines.
    const base = BigInt(total.div(n).floor().toFixed(0));
    for (let i = 0; i < n; i++) shares[i] = base;
    allocated = base * BigInt(n);
  } else {
    for (let i = 0; i < n; i++) {
      const share = BigInt(total.times(w[i]!).div(sum).floor().toFixed(0));
      shares[i] = share;
      allocated += share;
    }
  }

  // Hand the leftover paise to the largest-weight line (first one on a tie).
  let remainder = totalPaise - allocated;
  if (remainder > 0n) {
    let maxIdx = 0;
    for (let i = 1; i < n; i++) if (w[i]!.gt(w[maxIdx]!)) maxIdx = i;
    shares[maxIdx] = shares[maxIdx]! + remainder;
    remainder = 0n;
  }
  return shares;
}

/** New moving weighted-average cost (paise) after receiving `qtyIn` at `unitCostPaise` on top
 *  of `qtyOnHand` at `oldAvgPaise`. Integer paise, HALF_UP. Pure. */
export function movingAverage(
  qtyOnHand: DecimalInput,
  oldAvgPaise: bigint,
  qtyIn: DecimalInput,
  unitCostPaise: bigint,
): bigint {
  const onHand = new Decimal(qtyOnHand);
  const inQty = new Decimal(qtyIn);
  const denom = onHand.plus(inQty);
  if (denom.lte(0)) return 0n;
  const value = onHand
    .times(oldAvgPaise.toString())
    .plus(inQty.times(unitCostPaise.toString()));
  return BigInt(value.div(denom).toDecimalPlaces(0).toFixed(0));
}

/** Inverse of `movingAverage` — the average after removing `qtyOut` at `unitCostPaise` (used to
 *  unwind a cancelled receipt). Exact for the most recent receipt; a reasonable approximation
 *  otherwise. Drops to 0 when nothing remains. Pure. */
export function reverseMovingAverage(
  qtyOnHand: DecimalInput,
  oldAvgPaise: bigint,
  qtyOut: DecimalInput,
  unitCostPaise: bigint,
): bigint {
  const onHand = new Decimal(qtyOnHand);
  const outQty = new Decimal(qtyOut);
  const denom = onHand.minus(outQty);
  if (denom.lte(0)) return 0n;
  const value = onHand
    .times(oldAvgPaise.toString())
    .minus(outQty.times(unitCostPaise.toString()));
  const avg = value.div(denom);
  return avg.lte(0) ? 0n : BigInt(avg.toDecimalPlaces(0).toFixed(0));
}

/** Per-unit landed cost = supplier rate + apportioned charges spread over the quantity. Pure. */
export function landedUnitCost(
  ratePaise: bigint,
  apportionedChargePaise: bigint,
  qty: DecimalInput,
): bigint {
  const q = new Decimal(qty);
  if (q.lte(0)) return ratePaise;
  const perUnit = new Decimal(ratePaise.toString()).plus(
    new Decimal(apportionedChargePaise.toString()).div(q),
  );
  return BigInt(perUnit.toDecimalPlaces(0).toFixed(0));
}

// --- charge apportionment across a GRN's lines ---------------------------------------

export interface ChargeInput {
  chargeType: ChargeType;
  amountPaise: bigint | number;
  apportionBasis?: ApportionBasis;
  note?: string | null;
}

interface CostLine {
  id: string;
  itemId: string;
  qty: Decimal;
  ratePaise: bigint;
  uomBase: string;
}

/** The weight metric a basis uses for a line. */
function basisWeight(basis: ApportionBasis, line: CostLine): Decimal {
  if (basis === "QTY") return line.qty;
  if (basis === "WEIGHT") return line.uomBase === "KG" ? line.qty : new Decimal(0);
  return line.qty.times(line.ratePaise.toString()); // VALUE
}

// --- services ------------------------------------------------------------------------

/**
 * Cost a goods receipt: persist its charges, apportion each across the lines by its basis,
 * write each line's per-unit landed cost, and roll every line into its item's moving-average
 * cost (append-only `ItemCostHistory`). One-shot — a GRN already costed is refused (re-costing
 * would double-count). Charges may be empty (landed cost = supplier rate). STORES-write.
 */
export async function addGrnCharges(
  tx: Tx,
  actor: Actor,
  grnId: string,
  charges: ChargeInput[],
): Promise<GoodsReceipt> {
  requireAccess(actor, "STORES", "write");
  const grn = await tx.goodsReceipt.findFirst({
    where: { id: grnId, companyId: actor.companyId },
    include: { lines: { include: { item: true } } },
  });
  if (!grn) throw new AuthzError("goods receipt not found");
  if (grn.status !== "POSTED") {
    throw new LandedCostError([`goods receipt ${grn.docNo} is ${grn.status}`]);
  }
  if (grn.lines.length === 0) throw new LandedCostError(["receipt has no lines"]);
  if (grn.lines.some((l) => l.landedUnitCostPaise != null)) {
    throw new LandedCostError(["this receipt is already costed"]);
  }
  const missingRate = grn.lines.filter((l) => l.ratePaise == null);
  if (missingRate.length) {
    throw new LandedCostError(["every line needs a rate before costing"]);
  }

  const lines: CostLine[] = grn.lines.map((l) => ({
    id: l.id,
    itemId: l.itemId,
    qty: new Decimal(l.qtyReceived.toString()),
    ratePaise: l.ratePaise!,
    uomBase: l.item.uomBase,
  }));

  // Persist charges and accumulate each line's apportioned charge total.
  const chargeByLine = new Map<string, bigint>(lines.map((l) => [l.id, 0n]));
  for (const c of charges) {
    const amount = BigInt(c.amountPaise);
    if (amount <= 0n) throw new LandedCostError(["a charge amount must be > 0"]);
    const basis = c.apportionBasis ?? "VALUE";
    await tx.grnCharge.create({
      data: {
        companyId: actor.companyId,
        grnId: grn.id,
        chargeType: c.chargeType,
        amountPaise: amount,
        apportionBasis: basis,
        note: c.note ?? null,
      },
    });
    const shares = apportion(
      lines.map((l) => basisWeight(basis, l)),
      amount,
    );
    lines.forEach((l, i) => {
      chargeByLine.set(l.id, chargeByLine.get(l.id)! + shares[i]!);
    });
  }

  // Landed unit cost per line, then roll into each item's moving average (sequential).
  for (const l of lines) {
    const unit = landedUnitCost(l.ratePaise, chargeByLine.get(l.id)!, l.qty);
    await tx.goodsReceiptLine.update({
      where: { id: l.id },
      data: { landedUnitCostPaise: unit },
    });

    const item = await tx.item.findUniqueOrThrow({ where: { id: l.itemId } });
    const newAvg = movingAverage(
      item.costedQtyBase.toString(),
      item.movingAvgCostPaise,
      l.qty,
      unit,
    );
    await tx.item.update({
      where: { id: l.itemId },
      data: {
        movingAvgCostPaise: newAvg,
        costedQtyBase: new Decimal(item.costedQtyBase.toString()).plus(l.qty).toString(),
      },
    });
    await tx.itemCostHistory.create({
      data: {
        companyId: actor.companyId,
        itemId: l.itemId,
        grnLineId: l.id,
        qtyIn: l.qty.toString(),
        unitCostPaise: unit,
        newMovingAvgPaise: newAvg,
      },
    });
  }

  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "GoodsReceipt",
    entityId: grn.id,
    action: "COST",
    actorUserId: actor.userId,
    after: { docNo: grn.docNo, charges: charges.length, lines: lines.length },
  });
  return grn;
}

/** Unwind a costed GRN's landed cost (called by S15 `cancelGRN`): reverse each line's moving-
 *  average contribution, clear the line's landed cost, and log an offsetting cost-history row.
 *  A no-op for an un-costed receipt. Assumes the caller has already authorised the cancel. */
export async function reverseLandedCost(
  tx: Tx,
  companyId: string,
  actorUserId: string | null,
  grnId: string,
): Promise<void> {
  const lines = await tx.goodsReceiptLine.findMany({
    where: { grnId, landedUnitCostPaise: { not: null } },
  });
  for (const l of lines) {
    const item = await tx.item.findUniqueOrThrow({ where: { id: l.itemId } });
    const qty = new Decimal(l.qtyReceived.toString());
    const unit = l.landedUnitCostPaise!;
    const newAvg = reverseMovingAverage(
      item.costedQtyBase.toString(),
      item.movingAvgCostPaise,
      qty,
      unit,
    );
    const newQty = new Decimal(item.costedQtyBase.toString()).minus(qty);
    await tx.item.update({
      where: { id: l.itemId },
      data: {
        movingAvgCostPaise: newAvg,
        costedQtyBase: (newQty.lt(0) ? new Decimal(0) : newQty).toString(),
      },
    });
    await tx.itemCostHistory.create({
      data: {
        companyId,
        itemId: l.itemId,
        grnLineId: l.id,
        qtyIn: qty.negated().toString(),
        unitCostPaise: unit,
        newMovingAvgPaise: newAvg,
      },
    });
    await tx.goodsReceiptLine.update({
      where: { id: l.id },
      data: { landedUnitCostPaise: null },
    });
  }
  if (lines.length) {
    await writeAudit(tx, {
      companyId,
      entity: "GoodsReceipt",
      entityId: grnId,
      action: "COST_REVERSE",
      actorUserId,
      after: { lines: lines.length },
    });
  }
}

// --- valuation (read) ----------------------------------------------------------------

export interface ItemStockValue {
  qtyOnHand: Decimal;
  movingAvgCostPaise: bigint;
  valuePaise: bigint;
}

/** On-hand stock value for an item = total bulk balance (all locations) × moving-average cost. */
export async function itemStockValue(
  db: Tx,
  companyId: string,
  itemId: string,
): Promise<ItemStockValue> {
  const [item, balances] = await Promise.all([
    db.item.findFirstOrThrow({ where: { id: itemId, companyId } }),
    db.stockBalance.findMany({ where: { companyId, itemId } }),
  ]);
  const qtyOnHand = balances.reduce(
    (s, b) => s.plus(b.qtyBase.toString()),
    new Decimal(0),
  );
  const valuePaise = BigInt(
    qtyOnHand.times(item.movingAvgCostPaise.toString()).toDecimalPlaces(0).toFixed(0),
  );
  return { qtyOnHand, movingAvgCostPaise: item.movingAvgCostPaise, valuePaise };
}
