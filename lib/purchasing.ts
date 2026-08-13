// lib/purchasing.ts — purchase orders (spec S14).
// Raise a PO to a supplier so goods receipt (S15) has a document to receive against, and so
// committed-but-not-received quantity is visible. Money in paise (BigInt); quantities
// Decimal in the item's base UOM. STORES-write gated, audited, gapless FY numbers,
// cancel-not-delete. The PO rate is indicative — the value of record comes at GRN/invoice.

import type { PurchaseOrder, Prisma } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { nextDocNumber } from "./doc-number.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

export class PurchaseValidationError extends Error {
  override name = "PurchaseValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure helpers --------------------------------------------------------------------

/** Line amount in paise = qty × rate-per-unit, rounded to the nearest paisa. Pure. */
export function lineAmountPaise(
  qtyOrdered: DecimalInput,
  ratePaise: number | bigint,
): number {
  return Number(
    new Decimal(qtyOrdered)
      .times(new Decimal(ratePaise.toString()))
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toString(),
  );
}

/** Total commitment value of a PO (Σ line amounts), in paise. Pure. */
export function poCommitmentPaise(
  lines: { qtyOrdered: DecimalInput; ratePaise: number | bigint }[],
): number {
  return lines.reduce((sum, l) => sum + lineAmountPaise(l.qtyOrdered, l.ratePaise), 0);
}

/** Outstanding quantity on a line = ordered − received (never below zero for display). Pure. */
export function lineBalance(
  qtyOrdered: DecimalInput,
  qtyReceived: DecimalInput,
): Decimal {
  return new Decimal(qtyOrdered).minus(qtyReceived);
}

/** True when every line is fully received (balance ≤ 0). Pure. */
export function isFullyReceived(
  lines: { qtyOrdered: DecimalInput; qtyReceived: DecimalInput }[],
): boolean {
  return lines.every((l) => lineBalance(l.qtyOrdered, l.qtyReceived).lte(0));
}

function validateLines(lines: PoLineInput[]): string[] {
  const errors: string[] = [];
  if (!lines?.length) errors.push("at least one line is required");
  lines?.forEach((l, i) => {
    const n = i + 1;
    if (!l.itemId) errors.push(`line ${n}: item is required`);
    try {
      if (new Decimal(l.qtyOrdered).lte(0))
        errors.push(`line ${n}: quantity must be > 0`);
    } catch {
      errors.push(`line ${n}: quantity is not a number`);
    }
    if (l.ratePaise == null || !Number.isFinite(l.ratePaise) || l.ratePaise < 0) {
      errors.push(`line ${n}: rate (paise) must be zero or more`);
    }
    if (l.gstRatePct != null && l.gstRatePct !== "") {
      try {
        const r = new Decimal(l.gstRatePct);
        if (r.lt(0) || r.gt(100)) errors.push(`line ${n}: GST rate must be 0–100`);
      } catch {
        errors.push(`line ${n}: GST rate is not a number`);
      }
    }
  });
  return errors;
}

// --- create / amend ------------------------------------------------------------------

export interface PoLineInput {
  itemId: string;
  qtyOrdered: DecimalInput;
  ratePaise: number;
  /** Defaults to the item's base UOM. */
  uom?: string;
  description?: string | null;
  gstRatePct?: DecimalInput | null;
  expectedDate?: Date | null;
}
export interface CreatePoInput {
  supplierId: string;
  lines: PoLineInput[];
  expectedDate?: Date | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  notes?: string | null;
  orderDate?: Date;
  /** Release straight to OPEN (receivable), or keep as DRAFT. Default OPEN. */
  status?: "DRAFT" | "OPEN";
}

async function resolveLines(tx: Tx, companyId: string, lines: PoLineInput[]) {
  const items = await tx.item.findMany({
    where: { id: { in: lines.map((l) => l.itemId) }, companyId },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  return lines.map((l) => {
    const item = byId.get(l.itemId);
    if (!item) throw new PurchaseValidationError([`item ${l.itemId} not found`]);
    return {
      itemId: l.itemId,
      description: l.description ?? item.name,
      qtyOrdered: String(l.qtyOrdered),
      uom: l.uom ?? item.uomBase,
      ratePaise: BigInt(Math.round(l.ratePaise)),
      gstRatePct:
        l.gstRatePct != null && l.gstRatePct !== ""
          ? String(l.gstRatePct)
          : (item.gstRatePct?.toString() ?? null),
      expectedDate: l.expectedDate ?? null,
    };
  });
}

export async function createPO(
  tx: Tx,
  actor: Actor,
  input: CreatePoInput,
): Promise<PurchaseOrder> {
  requireAccess(actor, "STORES", "write");
  const errors = validateLines(input.lines);
  if (!input.supplierId) errors.push("supplier is required");
  if (errors.length) throw new PurchaseValidationError(errors);

  const supplier = await tx.supplier.findFirst({
    where: { id: input.supplierId, companyId: actor.companyId },
  });
  if (!supplier) throw new PurchaseValidationError(["supplier not found"]);

  const lineData = await resolveLines(tx, actor.companyId, input.lines);
  const docNo = await nextDocNumber(tx, actor.companyId, "PURCHASE_ORDER", {
    prefix: "PO",
    ...(input.orderDate ? { now: input.orderDate } : {}),
  });
  const po = await tx.purchaseOrder.create({
    data: {
      companyId: actor.companyId,
      docNo,
      supplierId: input.supplierId,
      status: input.status ?? "OPEN",
      ...(input.orderDate ? { orderDate: input.orderDate } : {}),
      expectedDate: input.expectedDate ?? null,
      paymentTerms: input.paymentTerms ?? supplier.paymentTerms ?? null,
      deliveryTerms: input.deliveryTerms ?? null,
      notes: input.notes ?? null,
      createdById: actor.userId,
      lines: { create: lineData },
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "PurchaseOrder",
    entityId: po.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: {
      docNo: po.docNo,
      supplierId: po.supplierId,
      lines: lineData.length,
      status: po.status,
    },
  });
  return po;
}

export interface UpdatePoInput {
  expectedDate?: Date | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  notes?: string | null;
  /** Replace all lines. Only allowed while no line has been received. */
  lines?: PoLineInput[];
  /** Release a DRAFT to OPEN. */
  release?: boolean;
}

/** Amend an editable PO (DRAFT/OPEN, nothing received). Line replacement is refused once any
 *  quantity has been received against the PO. */
export async function updatePO(
  tx: Tx,
  actor: Actor,
  poId: string,
  patch: UpdatePoInput,
): Promise<PurchaseOrder> {
  requireAccess(actor, "STORES", "write");
  const po = await tx.purchaseOrder.findFirst({
    where: { id: poId, companyId: actor.companyId },
    include: { lines: true },
  });
  if (!po) throw new AuthzError("purchase order not found");
  if (po.status === "CLOSED" || po.status === "CANCELLED") {
    throw new PurchaseValidationError([
      `PO ${po.docNo} is ${po.status} and cannot be edited`,
    ]);
  }

  if (patch.lines) {
    const received = po.lines.some((l) => new Decimal(l.qtyReceived.toString()).gt(0));
    if (received) {
      throw new PurchaseValidationError([
        "cannot replace lines after goods have been received",
      ]);
    }
    const errors = validateLines(patch.lines);
    if (errors.length) throw new PurchaseValidationError(errors);
    const lineData = await resolveLines(tx, actor.companyId, patch.lines);
    await tx.purchaseOrderLine.deleteMany({ where: { poId } });
    await tx.purchaseOrderLine.createMany({
      data: lineData.map((l) => ({ ...l, poId })),
    });
  }

  const updated = await tx.purchaseOrder.update({
    where: { id: poId },
    data: {
      ...(patch.expectedDate !== undefined ? { expectedDate: patch.expectedDate } : {}),
      ...(patch.paymentTerms !== undefined ? { paymentTerms: patch.paymentTerms } : {}),
      ...(patch.deliveryTerms !== undefined
        ? { deliveryTerms: patch.deliveryTerms }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.release && po.status === "DRAFT" ? { status: "OPEN" } : {}),
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "PurchaseOrder",
    entityId: poId,
    action: patch.release && po.status === "DRAFT" ? "RELEASE" : "UPDATE",
    actorUserId: actor.userId,
    before: { status: po.status },
    after: {
      status: updated.status,
      linesReplaced: patch.lines ? patch.lines.length : undefined,
    },
  });
  return updated;
}

// --- close / cancel ------------------------------------------------------------------

/** Close a PO. Fully-received closes cleanly; a short-close (undelivered balance remaining)
 *  requires a reason. */
export async function closePO(
  tx: Tx,
  actor: Actor,
  poId: string,
  reason?: string,
): Promise<PurchaseOrder> {
  requireAccess(actor, "STORES", "write");
  const po = await tx.purchaseOrder.findFirst({
    where: { id: poId, companyId: actor.companyId },
    include: { lines: true },
  });
  if (!po) throw new AuthzError("purchase order not found");
  if (po.status !== "OPEN") {
    throw new PurchaseValidationError([`PO ${po.docNo} is ${po.status}, not OPEN`]);
  }
  const complete = isFullyReceived(
    po.lines.map((l) => ({
      qtyOrdered: l.qtyOrdered.toString(),
      qtyReceived: l.qtyReceived.toString(),
    })),
  );
  if (!complete && !reason?.trim()) {
    throw new PurchaseValidationError([
      "a reason is required to short-close a PO with an undelivered balance",
    ]);
  }
  const updated = await tx.purchaseOrder.update({
    where: { id: poId },
    data: { status: "CLOSED", closeReason: complete ? null : reason!.trim() },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "PurchaseOrder",
    entityId: poId,
    action: "CLOSE",
    actorUserId: actor.userId,
    before: { status: "OPEN" },
    after: {
      status: "CLOSED",
      shortClose: !complete,
      reason: complete ? null : reason?.trim(),
    },
  });
  return updated;
}

/** Cancel a PO (keeps its number). Refused once anything has been received — cancel the GRNs
 *  first. */
export async function cancelPO(
  tx: Tx,
  actor: Actor,
  poId: string,
): Promise<PurchaseOrder> {
  requireAccess(actor, "STORES", "write");
  const po = await tx.purchaseOrder.findFirst({
    where: { id: poId, companyId: actor.companyId },
    include: { lines: true },
  });
  if (!po) throw new AuthzError("purchase order not found");
  if (po.status === "CANCELLED") {
    throw new PurchaseValidationError(["PO is already cancelled"]);
  }
  if (po.status === "CLOSED") {
    throw new PurchaseValidationError(["a closed PO cannot be cancelled"]);
  }
  if (po.lines.some((l) => new Decimal(l.qtyReceived.toString()).gt(0))) {
    throw new PurchaseValidationError([
      "cannot cancel a PO with received goods — cancel the GRNs first",
    ]);
  }
  const updated = await tx.purchaseOrder.update({
    where: { id: poId },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "PurchaseOrder",
    entityId: poId,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: po.status },
    after: { status: "CANCELLED", docNo: po.docNo },
  });
  return updated;
}

// --- balance view (for display / S15) ------------------------------------------------

export interface PoLineBalance {
  lineId: string;
  itemId: string;
  qtyOrdered: Decimal;
  qtyReceived: Decimal;
  balance: Decimal;
  amountPaise: number;
}
export interface PoBalance {
  lines: PoLineBalance[];
  commitmentPaise: number;
  fullyReceived: boolean;
}

/** Per-line ordered/received/outstanding + total commitment for a PO. */
export async function poBalance(tx: Tx, poId: string): Promise<PoBalance> {
  const lines = await tx.purchaseOrderLine.findMany({ where: { poId } });
  const detail = lines.map((l) => ({
    lineId: l.id,
    itemId: l.itemId,
    qtyOrdered: new Decimal(l.qtyOrdered.toString()),
    qtyReceived: new Decimal(l.qtyReceived.toString()),
    balance: lineBalance(l.qtyOrdered.toString(), l.qtyReceived.toString()),
    amountPaise: lineAmountPaise(l.qtyOrdered.toString(), l.ratePaise),
  }));
  return {
    lines: detail,
    commitmentPaise: detail.reduce((s, l) => s + l.amountPaise, 0),
    fullyReceived: detail.every((l) => l.balance.lte(0)),
  };
}
