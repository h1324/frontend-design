// lib/goods-receipt.ts — goods receipt / GRN (spec S15).
// Receive supplier goods against a PO (S14): record what arrived, post a BULK IN into a
// QC-hold location (physically present but not free/issuable until S16 passes it), and
// update the PO balance. Money in paise (BigInt); quantities Decimal. STORES-write gated,
// audited, gapless FY numbers, cancel-not-delete (reversal refused once the stock has moved).

import type { GoodsReceipt, Prisma } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { nextDocNumber } from "./doc-number.js";
import { post, reverse } from "./stock-ledger.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

export class GrnValidationError extends Error {
  override name = "GrnValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure helpers --------------------------------------------------------------------

/** Quantity still to receive on a PO line = ordered − already received. Pure. */
export function remainingToReceive(
  qtyOrdered: DecimalInput,
  alreadyReceived: DecimalInput,
): Decimal {
  return new Decimal(qtyOrdered).minus(alreadyReceived);
}

/** True when receiving `receiving` would exceed the ordered quantity (over-receipt). Pure. */
export function wouldOverReceive(
  qtyOrdered: DecimalInput,
  alreadyReceived: DecimalInput,
  receiving: DecimalInput,
): boolean {
  return new Decimal(alreadyReceived).plus(receiving).gt(qtyOrdered);
}

// --- create --------------------------------------------------------------------------

export interface GrnLineInput {
  itemId: string;
  qtyReceived: DecimalInput;
  /** Links this receipt to a PO line, so its ordered balance updates. */
  poLineId?: string | null;
  ratePaise?: number | null;
}
export interface CreateGrnInput {
  /** Receiving against a PO (recommended) — supplier defaults from it. */
  poId?: string | null;
  /** Required for a direct (PO-less) receipt. */
  supplierId?: string | null;
  /** QC-hold location to receive into. Defaults to the company's QC-hold location. */
  holdLocationId?: string | null;
  docketNo?: string | null;
  vehicleNo?: string | null;
  receivedAt?: Date;
  lines: GrnLineInput[];
}

async function resolveHoldLocation(
  tx: Tx,
  companyId: string,
  holdLocationId?: string | null,
) {
  if (holdLocationId) {
    const loc = await tx.location.findFirst({
      where: { id: holdLocationId, companyId, isQcHold: true },
    });
    if (!loc)
      throw new GrnValidationError(["the chosen location is not a QC-hold location"]);
    return loc;
  }
  const loc = await tx.location.findFirst({
    where: { companyId, isQcHold: true },
    orderBy: { code: "asc" },
  });
  if (!loc) {
    throw new GrnValidationError([
      "no QC-hold location configured — create a location with isQcHold set",
    ]);
  }
  return loc;
}

/**
 * Receive goods: post a BULK IN per line into the QC-hold location (reason GRN), record the
 * lines PENDING QC, and bump each linked PO line's received quantity. Over-receipt beyond the
 * ordered balance is blocked.
 */
export async function createGRN(
  tx: Tx,
  actor: Actor,
  input: CreateGrnInput,
): Promise<GoodsReceipt> {
  requireAccess(actor, "STORES", "write");
  const errors: string[] = [];
  if (!input.lines?.length) errors.push("at least one line is required");
  input.lines?.forEach((l, i) => {
    if (!l.itemId) errors.push(`line ${i + 1}: item is required`);
    try {
      if (new Decimal(l.qtyReceived).lte(0))
        errors.push(`line ${i + 1}: quantity must be > 0`);
    } catch {
      errors.push(`line ${i + 1}: quantity is not a number`);
    }
  });
  if (errors.length) throw new GrnValidationError(errors);

  const holdLocation = await resolveHoldLocation(
    tx,
    actor.companyId,
    input.holdLocationId,
  );

  // Load the PO (if any) and validate it is receivable; index its lines.
  let supplierId = input.supplierId ?? null;
  const poLineById = new Map<
    string,
    { id: string; qtyOrdered: Decimal; qtyReceived: Decimal; ratePaise: bigint }
  >();
  if (input.poId) {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: input.poId, companyId: actor.companyId },
      include: { lines: true },
    });
    if (!po) throw new GrnValidationError(["purchase order not found"]);
    if (po.status !== "OPEN") {
      throw new GrnValidationError([`PO ${po.docNo} is ${po.status}, not OPEN`]);
    }
    supplierId = supplierId ?? po.supplierId;
    for (const l of po.lines) {
      poLineById.set(l.id, {
        id: l.id,
        qtyOrdered: new Decimal(l.qtyOrdered.toString()),
        qtyReceived: new Decimal(l.qtyReceived.toString()),
        ratePaise: l.ratePaise,
      });
    }
  }

  // Over-receipt check (aggregate this GRN's quantity per PO line on top of prior receipts).
  const receivingByPoLine = new Map<string, Decimal>();
  for (const l of input.lines) {
    if (!l.poLineId) continue;
    const poLine = poLineById.get(l.poLineId);
    if (!poLine)
      throw new GrnValidationError([`PO line ${l.poLineId} is not on this PO`]);
    const running = (receivingByPoLine.get(l.poLineId) ?? new Decimal(0)).plus(
      l.qtyReceived,
    );
    receivingByPoLine.set(l.poLineId, running);
    if (wouldOverReceive(poLine.qtyOrdered, poLine.qtyReceived, running)) {
      throw new GrnValidationError([
        `over-receipt on a PO line: ordered ${poLine.qtyOrdered}, already ${poLine.qtyReceived}, receiving ${running}`,
      ]);
    }
  }

  const docNo = await nextDocNumber(tx, actor.companyId, "GOODS_RECEIPT", {
    prefix: "GRN",
    ...(input.receivedAt ? { now: input.receivedAt } : {}),
  });
  const grn = await tx.goodsReceipt.create({
    data: {
      companyId: actor.companyId,
      docNo,
      supplierId,
      poId: input.poId ?? null,
      docketNo: input.docketNo ?? null,
      vehicleNo: input.vehicleNo ?? null,
      createdById: actor.userId,
      ...(input.receivedAt ? { receivedAt: input.receivedAt } : {}),
    },
  });

  for (const l of input.lines) {
    const poLine = l.poLineId ? poLineById.get(l.poLineId) : undefined;
    const ratePaise =
      l.ratePaise != null ? BigInt(Math.round(l.ratePaise)) : (poLine?.ratePaise ?? null);
    const created = await tx.goodsReceiptLine.create({
      data: {
        grnId: grn.id,
        poLineId: l.poLineId ?? null,
        itemId: l.itemId,
        locationId: holdLocation.id,
        qtyReceived: String(l.qtyReceived),
        ratePaise,
      },
    });
    const posting = await post(tx, {
      grain: "BULK",
      direction: "IN",
      companyId: actor.companyId,
      itemId: l.itemId,
      locationId: holdLocation.id,
      qtyBase: l.qtyReceived,
      reason: "GRN",
      refType: "GoodsReceipt",
      refId: grn.id,
      actorUserId: actor.userId,
    });
    await tx.goodsReceiptLine.update({
      where: { id: created.id },
      data: { ledgerId: posting.id },
    });
    if (l.poLineId) {
      await tx.purchaseOrderLine.update({
        where: { id: l.poLineId },
        data: { qtyReceived: { increment: String(l.qtyReceived) } },
      });
    }
  }

  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "GoodsReceipt",
    entityId: grn.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: {
      docNo: grn.docNo,
      poId: grn.poId,
      lines: input.lines.length,
      holdLocation: holdLocation.code,
    },
  });
  return grn;
}

// --- cancel --------------------------------------------------------------------------

/** Cancel a GRN: reverse each line's BULK IN (S3) and restore the PO balance. Refused once QC
 *  has actioned a line (stock has moved on) or if a reversal would drive stock negative. */
export async function cancelGRN(
  tx: Tx,
  actor: Actor,
  grnId: string,
): Promise<GoodsReceipt> {
  requireAccess(actor, "STORES", "write");
  const grn = await tx.goodsReceipt.findFirst({
    where: { id: grnId, companyId: actor.companyId },
    include: { lines: true },
  });
  if (!grn) throw new AuthzError("goods receipt not found");
  if (grn.status === "CANCELLED") {
    throw new GrnValidationError(["goods receipt is already cancelled"]);
  }
  if (grn.lines.some((l) => l.qcStatus !== "PENDING")) {
    throw new GrnValidationError([
      "QC has already actioned this receipt — cannot cancel",
    ]);
  }

  for (const line of grn.lines) {
    if (line.ledgerId) {
      // Reversal drives the hold-location balance down; S3 refuses if it would go negative.
      await reverse(tx, line.ledgerId, actor.userId, `GRN ${grn.docNo} cancelled`);
    }
    if (line.poLineId) {
      await tx.purchaseOrderLine.update({
        where: { id: line.poLineId },
        data: { qtyReceived: { decrement: line.qtyReceived.toString() } },
      });
    }
  }

  const updated = await tx.goodsReceipt.update({
    where: { id: grnId },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "GoodsReceipt",
    entityId: grnId,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: "POSTED" },
    after: { status: "CANCELLED", docNo: grn.docNo },
  });
  return updated;
}

// --- balances ------------------------------------------------------------------------

async function bulkBalance(
  db: Tx,
  companyId: string,
  itemId: string,
  hold: boolean,
): Promise<Decimal> {
  const rows = await db.stockBalance.findMany({
    where: { companyId, itemId, location: { isQcHold: hold } },
  });
  return rows.reduce((sum, r) => sum.plus(r.qtyBase.toString()), new Decimal(0));
}

/** Free (issuable) bulk balance for an item = stock outside QC-hold locations. */
export function freeBulkBalance(
  db: Tx,
  companyId: string,
  itemId: string,
): Promise<Decimal> {
  return bulkBalance(db, companyId, itemId, false);
}

/** Bulk balance currently on QC hold for an item. */
export function heldBulkBalance(
  db: Tx,
  companyId: string,
  itemId: string,
): Promise<Decimal> {
  return bulkBalance(db, companyId, itemId, true);
}
