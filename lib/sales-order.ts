// lib/sales-order.ts — sales orders, credit control & tier scoring (spec S18).
// An order layer over Phase-1 direct dispatch: capture a customer order, reserve stock against
// it (S3 allocateRolls), enforce the credit limit (S7) at confirmation with a logged override,
// and fulfil it through dispatch (S13). Numbers are gapless per FY (S2); cancel-not-delete;
// every state change is audited. This is not the statutory ledger — receivables/payments live
// in Tally; the credit check consumes the outstanding figure from lib/receivables.ts.

import type {
  CreditStatus,
  Prisma,
  SalesOrder,
  DispatchNote,
  CustomerTier,
} from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, requireRole, AuthzError, type Actor } from "./rbac.js";
import { nextDocNumber } from "./doc-number.js";
import { allocateRolls } from "./stock-ledger.js";
import { writeAudit } from "./audit.js";
import { isIntraState, lineTaxableValuePaise, computeLineTax } from "./gst.js";
import { customerOutstandingPaise } from "./receivables.js";
import { scoreTier, type TierConfig, DEFAULT_TIER_CONFIG } from "./customer-tier.js";

type Tx = Prisma.TransactionClient;

export class SalesOrderValidationError extends Error {
  override name = "SalesOrderValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure helpers --------------------------------------------------------------------

export interface OrderLineValue {
  qtyOrdered: DecimalInput;
  ratePaise: number | bigint;
  gstRatePct: DecimalInput;
}
export interface OrderTotals {
  taxablePaise: number;
  taxPaise: number;
  totalPaise: number;
}

/** Value an order's lines (taxable + GST + grand total, in paise). `intra` picks CGST+SGST vs
 *  IGST but the split doesn't change the total; used for the credit exposure. Pure. */
export function salesOrderTotalsPaise(
  lines: OrderLineValue[],
  intra: boolean,
): OrderTotals {
  let taxablePaise = 0;
  let taxPaise = 0;
  for (const l of lines) {
    const taxable = lineTaxableValuePaise(l.qtyOrdered, l.ratePaise);
    const tax = computeLineTax(taxable, l.gstRatePct, intra);
    taxablePaise += taxable;
    taxPaise += tax.cgstPaise + tax.sgstPaise + tax.igstPaise;
  }
  return { taxablePaise, taxPaise, totalPaise: taxablePaise + taxPaise };
}

/** Credit exposure (paise) = current outstanding + this order's grand total. Pure. */
export function creditExposurePaise(
  outstandingPaise: bigint | number,
  orderTotalPaise: bigint | number,
): Decimal {
  return new Decimal(outstandingPaise.toString()).plus(orderTotalPaise.toString());
}

/** Is the order over the customer's credit limit? `creditLimit` is in rupees (Decimal);
 *  exposure is in paise. Zero/negative limit = cash terms → any exposure > 0 blocks. Pure. */
export function isCreditBlocked(
  outstandingPaise: bigint | number,
  orderTotalPaise: bigint | number,
  creditLimitRupees: DecimalInput,
): boolean {
  const exposure = creditExposurePaise(outstandingPaise, orderTotalPaise);
  const limitPaise = new Decimal(creditLimitRupees).times(100);
  return exposure.gt(limitPaise);
}

/** Remaining quantity to fulfil on a line. Pure. */
export function lineRemaining(
  qtyOrdered: DecimalInput,
  qtyFulfilled: DecimalInput,
): Decimal {
  return new Decimal(qtyOrdered).minus(qtyFulfilled);
}

// --- create --------------------------------------------------------------------------

export interface SalesOrderLineInput {
  itemId: string;
  qtyOrdered: DecimalInput;
  uom: string;
  ratePaise: number;
  gstRatePct: DecimalInput;
}
export interface CreateSalesOrderInput {
  customerId: string;
  shipToId: string;
  lines: SalesOrderLineInput[];
  orderDate?: Date;
}

/** Create a DRAFT sales order with its lines. SALES-write. Gapless SO/FY number. */
export async function createSO(
  tx: Tx,
  actor: Actor,
  input: CreateSalesOrderInput,
): Promise<SalesOrder> {
  requireAccess(actor, "SALES", "write");
  const errors: string[] = [];
  if (!input.customerId) errors.push("customer is required");
  if (!input.shipToId) errors.push("ship-to is required");
  if (!input.lines?.length) errors.push("at least one line is required");
  input.lines?.forEach((l, i) => {
    if (!l.itemId) errors.push(`line ${i + 1}: item is required`);
    if (!new Decimal(l.qtyOrdered).gt(0)) errors.push(`line ${i + 1}: qty must be > 0`);
    if (!(l.ratePaise > 0)) errors.push(`line ${i + 1}: rate must be > 0`);
  });
  if (errors.length) throw new SalesOrderValidationError(errors);

  // Ship-to must belong to the customer (and the customer to this company).
  const shipTo = await tx.shipToAddress.findFirst({
    where: {
      id: input.shipToId,
      customer: { id: input.customerId, companyId: actor.companyId },
    },
  });
  if (!shipTo)
    throw new SalesOrderValidationError(["ship-to does not belong to the customer"]);

  const docNo = await nextDocNumber(tx, actor.companyId, "SALES_ORDER", {
    prefix: "SO",
    ...(input.orderDate ? { now: input.orderDate } : {}),
  });
  const so = await tx.salesOrder.create({
    data: {
      companyId: actor.companyId,
      docNo,
      customerId: input.customerId,
      shipToId: input.shipToId,
      ...(input.orderDate ? { orderDate: input.orderDate } : {}),
      createdById: actor.userId,
      lines: {
        create: input.lines.map((l) => ({
          itemId: l.itemId,
          qtyOrdered: new Decimal(l.qtyOrdered).toString(),
          uom: l.uom,
          ratePaise: BigInt(l.ratePaise),
          gstRatePct: new Decimal(l.gstRatePct).toString(),
        })),
      },
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "SalesOrder",
    entityId: so.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: { docNo: so.docNo, customerId: so.customerId, lines: input.lines.length },
  });
  return so;
}

// --- confirm & credit ----------------------------------------------------------------

async function loadOrder(tx: Tx, actor: Actor, soId: string) {
  const so = await tx.salesOrder.findFirst({
    where: { id: soId, companyId: actor.companyId },
    include: { lines: true, customer: true, shipTo: true, company: true },
  });
  if (!so) throw new AuthzError("sales order not found");
  return so;
}

/** The taxable/tax/total of an order, computed from its lines and the ship-to state. */
async function orderTotals(
  so: Awaited<ReturnType<typeof loadOrder>>,
): Promise<OrderTotals> {
  const sellerState = (so.company.gstin ?? "").slice(0, 2);
  const intra = sellerState ? isIntraState(sellerState, so.shipTo.gstStateCode) : true;
  return salesOrderTotalsPaise(
    so.lines.map((l) => ({
      qtyOrdered: l.qtyOrdered.toString(),
      ratePaise: l.ratePaise,
      gstRatePct: l.gstRatePct.toString(),
    })),
    intra,
  );
}

export interface ConfirmResult {
  order: SalesOrder;
  creditStatus: CreditStatus;
  outstandingPaise: bigint;
  orderTotalPaise: number;
  creditLimitRupees: string;
}

/**
 * Confirm a sales order after a credit check (spec S18 rule 1). Exposure = outstanding (S19) +
 * this order's total vs the customer's credit limit. Within limit → CONFIRMED, creditStatus OK.
 * Over limit → creditStatus BLOCKED, the order stays DRAFT and only proceeds via `overrideCredit`.
 * SALES-write.
 */
export async function confirmSO(
  tx: Tx,
  actor: Actor,
  soId: string,
): Promise<ConfirmResult> {
  requireAccess(actor, "SALES", "write");
  const so = await loadOrder(tx, actor, soId);
  if (so.status !== "DRAFT") {
    throw new SalesOrderValidationError([`order ${so.docNo} is ${so.status}, not DRAFT`]);
  }
  if (so.lines.length === 0) {
    throw new SalesOrderValidationError(["order has no lines"]);
  }

  const totals = await orderTotals(so);
  const outstanding = await customerOutstandingPaise(tx, actor.companyId, so.customerId);
  const blocked = isCreditBlocked(
    outstanding,
    totals.totalPaise,
    so.customer.creditLimit.toString(),
  );
  const creditStatus: CreditStatus = blocked ? "BLOCKED" : "OK";

  const updated = await tx.salesOrder.update({
    where: { id: so.id },
    data: {
      creditStatus,
      ...(blocked ? {} : { status: "CONFIRMED" }),
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "SalesOrder",
    entityId: so.id,
    action: blocked ? "CREDIT_BLOCK" : "CONFIRM",
    actorUserId: actor.userId,
    before: { status: "DRAFT" },
    after: {
      status: updated.status,
      creditStatus,
      outstandingPaise: outstanding.toString(),
      orderTotalPaise: totals.totalPaise,
      creditLimitRupees: so.customer.creditLimit.toString(),
    },
  });
  return {
    order: updated,
    creditStatus,
    outstandingPaise: outstanding,
    orderTotalPaise: totals.totalPaise,
    creditLimitRupees: so.customer.creditLimit.toString(),
  };
}

/** Clear a credit block with a logged reason and confirm the order (spec S18 rule 1). Only
 *  ACCOUNTS/ADMIN may override (open-question default). Valid only on a BLOCKED order. */
export async function overrideCredit(
  tx: Tx,
  actor: Actor,
  soId: string,
  reason: string,
): Promise<SalesOrder> {
  requireAccess(actor, "SALES", "read");
  requireRole(actor, "ACCOUNTS", "ADMIN");
  if (!reason?.trim()) {
    throw new SalesOrderValidationError(["an override reason is required"]);
  }
  const so = await loadOrder(tx, actor, soId);
  if (so.creditStatus !== "BLOCKED") {
    throw new SalesOrderValidationError(["order is not credit-blocked"]);
  }
  const updated = await tx.salesOrder.update({
    where: { id: so.id },
    data: {
      creditStatus: "OVERRIDDEN",
      status: "CONFIRMED",
      creditOverrideById: actor.userId,
      creditOverrideReason: reason.trim(),
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "SalesOrder",
    entityId: so.id,
    action: "CREDIT_OVERRIDE",
    actorUserId: actor.userId,
    before: { creditStatus: "BLOCKED", status: so.status },
    after: { creditStatus: "OVERRIDDEN", status: "CONFIRMED", reason: reason.trim() },
  });
  return updated;
}

// --- allocation ----------------------------------------------------------------------

/** Reserve specific available rolls against a confirmed order (AVAILABLE → ALLOCATED, S3),
 *  recording them as SO allocations. Curing/held rolls need the logged override. SALES-write. */
export async function allocateSO(
  tx: Tx,
  actor: Actor,
  soId: string,
  rollIds: string[],
  override?: { reason: string },
): Promise<void> {
  requireAccess(actor, "SALES", "write");
  const so = await loadOrder(tx, actor, soId);
  if (so.status !== "CONFIRMED" && so.status !== "PARTIALLY_FULFILLED") {
    throw new SalesOrderValidationError([
      `order ${so.docNo} is ${so.status} — confirm it before allocating`,
    ]);
  }
  if (!rollIds?.length) {
    throw new SalesOrderValidationError(["at least one roll is required"]);
  }

  await allocateRolls(tx, actor.companyId, rollIds, {
    actorUserId: actor.userId,
    refType: "SalesOrder",
    refId: soId,
    ...(override ? { override } : {}),
  });
  await tx.salesOrderRoll.createMany({
    data: rollIds.map((rollId) => ({ soId, rollId })),
    skipDuplicates: true,
  });
}

// --- fulfilment (dispatch against the SO) --------------------------------------------

export interface FulfilInput {
  /** Rolls to ship — must be reserved to this order (and still ALLOCATED). */
  rollIds: string[];
  transporter?: string | null;
  vehicleNo?: string | null;
  lrNo?: string | null;
  dispatchedAt?: Date;
}

/**
 * Create a dispatch note that fulfils the order from its reserved rolls (spec S18 rule 2 / S13).
 * The rolls are already ALLOCATED (from `allocateSO`), so no re-allocation happens; the note is
 * linked to the SO and each line's `qtyFulfilled` advances (over-fulfilment is refused). Invoice
 * the returned note via S13 `generateInvoice`. SALES-write.
 */
export async function fulfilSalesOrder(
  tx: Tx,
  actor: Actor,
  soId: string,
  input: FulfilInput,
): Promise<DispatchNote> {
  requireAccess(actor, "SALES", "write");
  const so = await loadOrder(tx, actor, soId);
  if (so.status !== "CONFIRMED" && so.status !== "PARTIALLY_FULFILLED") {
    throw new SalesOrderValidationError([
      `order ${so.docNo} is ${so.status} — cannot dispatch`,
    ]);
  }
  if (!input.rollIds?.length) {
    throw new SalesOrderValidationError(["at least one roll is required"]);
  }

  // Every roll must be reserved to this order and still ALLOCATED.
  const reserved = await tx.salesOrderRoll.findMany({
    where: { soId, rollId: { in: input.rollIds } },
    include: { roll: { include: { item: true } } },
  });
  const reservedIds = new Set(reserved.map((r) => r.rollId));
  const missing = input.rollIds.filter((id) => !reservedIds.has(id));
  if (missing.length) {
    throw new SalesOrderValidationError([
      `rolls not reserved to this order: ${missing.length}`,
    ]);
  }
  for (const r of reserved) {
    if (r.roll.state !== "ALLOCATED") {
      throw new SalesOrderValidationError([
        `roll ${r.roll.rollNo} is ${r.roll.state}, not reserved`,
      ]);
    }
  }

  // Shipped quantity per item, in each item's billed UOM.
  const shippedByItem = new Map<string, Decimal>();
  for (const r of reserved) {
    const billed = r.roll.item.uomBase === "KG" ? r.roll.qtyKgActual : r.roll.qtyM2;
    shippedByItem.set(
      r.roll.itemId,
      (shippedByItem.get(r.roll.itemId) ?? new Decimal(0)).plus(billed.toString()),
    );
  }
  // Match to SO lines and check for over-fulfilment.
  for (const [itemId, shipped] of shippedByItem) {
    const line = so.lines.find((l) => l.itemId === itemId);
    if (!line) {
      throw new SalesOrderValidationError([`shipping an item not on the order`]);
    }
    const remaining = lineRemaining(
      line.qtyOrdered.toString(),
      line.qtyFulfilled.toString(),
    );
    if (shipped.gt(remaining)) {
      throw new SalesOrderValidationError([
        `over-fulfilment on ${itemId}: shipping ${shipped.toString()} > remaining ${remaining.toString()}`,
      ]);
    }
  }

  const now = input.dispatchedAt ?? new Date();
  const docNo = await nextDocNumber(tx, actor.companyId, "DISPATCH_NOTE", {
    prefix: "DN",
    now,
  });
  const note = await tx.dispatchNote.create({
    data: {
      companyId: actor.companyId,
      docNo,
      customerId: so.customerId,
      shipToId: so.shipToId,
      salesOrderId: so.id,
      transporter: input.transporter ?? null,
      vehicleNo: input.vehicleNo ?? null,
      lrNo: input.lrNo ?? null,
      createdById: actor.userId,
      rolls: {
        create: input.rollIds.map((rollId) => ({ rollId })),
      },
    },
  });

  // Advance fulfilment on each affected line.
  for (const [itemId, shipped] of shippedByItem) {
    const line = so.lines.find((l) => l.itemId === itemId)!;
    await tx.salesOrderLine.update({
      where: { id: line.id },
      data: {
        qtyFulfilled: new Decimal(line.qtyFulfilled.toString()).plus(shipped).toString(),
      },
    });
  }

  // Recompute SO status from the (now updated) lines.
  const lines = await tx.salesOrderLine.findMany({ where: { soId: so.id } });
  const allDone = lines.every((l) =>
    new Decimal(l.qtyFulfilled.toString()).gte(l.qtyOrdered.toString()),
  );
  const anyDone = lines.some((l) => new Decimal(l.qtyFulfilled.toString()).gt(0));
  const nextStatus = allDone ? "FULFILLED" : anyDone ? "PARTIALLY_FULFILLED" : so.status;
  if (nextStatus !== so.status) {
    await tx.salesOrder.update({ where: { id: so.id }, data: { status: nextStatus } });
  }

  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "SalesOrder",
    entityId: so.id,
    action: "FULFIL",
    actorUserId: actor.userId,
    before: { status: so.status },
    after: { status: nextStatus, dispatchNote: note.docNo, rolls: input.rollIds.length },
  });
  return note;
}

// --- cancel --------------------------------------------------------------------------

/** Cancel a sales order: release its still-reserved rolls (ALLOCATED → AVAILABLE) and mark it
 *  CANCELLED, keeping the number (S2). A FULLY fulfilled order cannot be cancelled; existing
 *  shipments on a partially-fulfilled order are untouched. SALES-write. */
export async function cancelSO(tx: Tx, actor: Actor, soId: string): Promise<SalesOrder> {
  requireAccess(actor, "SALES", "write");
  const so = await tx.salesOrder.findFirst({
    where: { id: soId, companyId: actor.companyId },
    include: { allocations: true },
  });
  if (!so) throw new AuthzError("sales order not found");
  if (so.status === "CANCELLED") {
    throw new SalesOrderValidationError(["order is already cancelled"]);
  }
  if (so.status === "FULFILLED") {
    throw new SalesOrderValidationError(["a fulfilled order cannot be cancelled"]);
  }

  for (const a of so.allocations) {
    const res = await tx.roll.updateMany({
      where: { id: a.rollId, companyId: actor.companyId, state: "ALLOCATED" },
      data: { state: "AVAILABLE" },
    });
    if (res.count > 0) {
      await writeAudit(tx, {
        companyId: actor.companyId,
        entity: "Roll",
        entityId: a.rollId,
        action: "STATE",
        actorUserId: actor.userId,
        before: { state: "ALLOCATED" },
        after: { state: "AVAILABLE", reason: `SO ${so.docNo} cancelled` },
      });
    }
  }

  const updated = await tx.salesOrder.update({
    where: { id: so.id },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "SalesOrder",
    entityId: so.id,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: so.status },
    after: { status: "CANCELLED", docNo: so.docNo },
  });
  return updated;
}

// --- tier scoring --------------------------------------------------------------------

/** Recompute and persist a customer's tier from their trading history (spec S18 rule 3):
 *  rolling-12-month dispatched volume (kg, from issued invoices) + payment behaviour (S19;
 *  unknown for now → neutral). Deterministic via the pure `scoreTier`. */
export async function recomputeTier(
  tx: Tx,
  actor: Actor,
  customerId: string,
  config: TierConfig = DEFAULT_TIER_CONFIG,
  asOf: Date = new Date(),
): Promise<CustomerTier> {
  requireAccess(actor, "SALES", "read");
  const yearAgo = new Date(asOf);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const invoices = await tx.invoice.findMany({
    where: { companyId: actor.companyId, customerId, status: "ISSUED" },
    include: { lines: true },
    orderBy: { invoiceDate: "asc" },
  });

  let volumeKg = new Decimal(0);
  for (const inv of invoices) {
    if (inv.invoiceDate >= yearAgo) {
      for (const l of inv.lines) volumeKg = volumeKg.plus(l.qtyKg.toString());
    }
  }
  const first = invoices[0]?.invoiceDate ?? null;
  const monthsOfHistory = first
    ? Math.max(
        0,
        (asOf.getFullYear() - first.getFullYear()) * 12 +
          (asOf.getMonth() - first.getMonth()),
      )
    : 0;

  const tier = scoreTier(
    {
      rolling12mVolumeKg: volumeKg.toString(),
      onTimePaymentRatio: null, // payments live in Tally; S19 will supply this
      monthsOfHistory,
    },
    config,
  );

  const before = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
  if (before.tier !== tier) {
    await tx.customer.update({ where: { id: customerId }, data: { tier } });
    await writeAudit(tx, {
      companyId: actor.companyId,
      entity: "Customer",
      entityId: customerId,
      action: "TIER",
      actorUserId: actor.userId,
      before: { tier: before.tier },
      after: { tier, volumeKg: volumeKg.toString(), monthsOfHistory },
    });
  }
  return tier;
}
