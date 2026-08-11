// lib/converting.ts — converting orders (spec S17).
// Post-extrusion operations that consume parent rolls and produce child rolls: lamination
// (bond sheets), slitting (cut wide→narrow), bag-making. Closing an order posts SERIAL OUT
// for each parent (→ CONSUMED) and creates each child via S11 `receiveRoll` (SERIAL IN, own
// gapless roll number) in one transaction, recording the parent→child genealogy. Child
// dimensions/density derive via `lib/uom.ts` (multi-layer laminates). Material balance is a
// KPI, surfaced not reconciled. A CLOSED order is immutable except by cancellation, which
// reverses both sides. PRODUCTION-write gated, audited, gapless FY numbers.

import type {
  ConvertingOperation,
  ConvertingOrder,
  Prisma,
  RollState,
} from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { nextDocNumber } from "./doc-number.js";
import { receiveRoll, post, reverse, allocateRolls } from "./stock-ledger.js";
import { resolveItemAging } from "./items.js";
import { materialBalance, agingReadyDate } from "./production.js";
import { writeAudit } from "./audit.js";
import type { Dimensions } from "./uom.js";

type Tx = Prisma.TransactionClient;

export class ConvertingValidationError extends Error {
  override name = "ConvertingValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure operation rules ------------------------------------------------------------

/** Lamination re-cures (heat/adhesive reintroduces a rest period); slitting/bag-making do
 *  not — those children inherit the parents' aged status. Pure (spec S17 decision). */
export function childReCures(operation: ConvertingOperation): boolean {
  return operation === "LAMINATION";
}

/** The state a freshly-made child starts in: CURING for a re-curing operation (then aged +
 *  swept to AVAILABLE, S12), AVAILABLE otherwise. Pure. */
export function childInitialState(operation: ConvertingOperation): RollState {
  return childReCures(operation) ? "CURING" : "AVAILABLE";
}

// --- open / pick ---------------------------------------------------------------------

export interface OpenConvertingInput {
  operation: ConvertingOperation;
  machineId: string;
  shiftId: string;
  operatorId: string;
  targetItemId: string;
  startAt?: Date;
}

export async function openConverting(
  tx: Tx,
  actor: Actor,
  input: OpenConvertingInput,
): Promise<ConvertingOrder> {
  requireAccess(actor, "PRODUCTION", "write");
  const errors: string[] = [];
  if (!input.machineId) errors.push("machine is required");
  if (!input.shiftId) errors.push("shift is required");
  if (!input.operatorId) errors.push("operator is required");
  if (!input.targetItemId) errors.push("target item is required");
  if (errors.length) throw new ConvertingValidationError(errors);

  const docNo = await nextDocNumber(tx, actor.companyId, "CONVERTING", { prefix: "CV" });
  const order = await tx.convertingOrder.create({
    data: {
      companyId: actor.companyId,
      docNo,
      operation: input.operation,
      machineId: input.machineId,
      shiftId: input.shiftId,
      operatorId: input.operatorId,
      targetItemId: input.targetItemId,
      startedAt: input.startAt ?? new Date(),
      createdById: actor.userId,
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "ConvertingOrder",
    entityId: order.id,
    action: "OPEN",
    actorUserId: actor.userId,
    after: { docNo: order.docNo, operation: order.operation },
  });
  return order;
}

async function loadOpenOrder(tx: Tx, actor: Actor, orderId: string) {
  const order = await tx.convertingOrder.findFirst({
    where: { id: orderId, companyId: actor.companyId },
  });
  if (!order) throw new AuthzError("converting order not found");
  if (order.status !== "OPEN") {
    throw new ConvertingValidationError([
      `order ${order.docNo} is ${order.status}, not OPEN`,
    ]);
  }
  return order;
}

/** Reserve parent rolls for the order (AVAILABLE → ALLOCATED via S3) and record them as
 *  inputs. Consuming a curing/held roll needs the logged override (S12/S16). */
export async function pickParents(
  tx: Tx,
  actor: Actor,
  orderId: string,
  rollIds: string[],
  override?: { reason: string },
): Promise<void> {
  requireAccess(actor, "PRODUCTION", "write");
  await loadOpenOrder(tx, actor, orderId);
  if (!rollIds?.length)
    throw new ConvertingValidationError(["at least one parent roll is required"]);

  await allocateRolls(tx, actor.companyId, rollIds, {
    actorUserId: actor.userId,
    refType: "ConvertingOrder",
    refId: orderId,
    ...(override ? { override } : {}),
  });
  await tx.convertingInput.createMany({
    data: rollIds.map((rollId) => ({ orderId, rollId })),
    skipDuplicates: true,
  });
}

// --- close ---------------------------------------------------------------------------

export interface ChildRollInput {
  locationId: string;
  dimensions: Dimensions;
  actualKg: DecimalInput;
  /** Defaults to the order's target item. */
  itemId?: string;
}
export interface CloseConvertingInput {
  children: ChildRollInput[];
  scrapKg?: DecimalInput;
  trimKg?: DecimalInput;
  endAt?: Date;
}

/**
 * Close a converting order: consume every parent (SERIAL OUT → CONSUMED) and create the child
 * rolls (SERIAL IN via S11, each linked to this order for genealogy). Laminate children start
 * CURING with an aging-ready date; slit/bag children start AVAILABLE. Children inherit a
 * QC-passed status from their already-passed parents. Material balance is recorded, not
 * reconciled.
 */
export async function closeConverting(
  tx: Tx,
  actor: Actor,
  orderId: string,
  input: CloseConvertingInput,
): Promise<ConvertingOrder> {
  requireAccess(actor, "PRODUCTION", "write");
  const order = await loadOpenOrder(tx, actor, orderId);
  const inputs = await tx.convertingInput.findMany({
    where: { orderId },
    include: { roll: true },
  });
  if (inputs.length === 0)
    throw new ConvertingValidationError(["no parent rolls picked"]);
  if (!input.children?.length)
    throw new ConvertingValidationError(["at least one child roll is required"]);

  const now = input.endAt ?? new Date();

  // Consume parents.
  let inputKg = new Decimal(0);
  for (const inp of inputs) {
    await post(tx, {
      grain: "SERIAL",
      direction: "OUT",
      companyId: actor.companyId,
      rollId: inp.rollId,
      reason: "CONVERT_OUT",
      setRollState: "CONSUMED",
      refType: "ConvertingOrder",
      refId: order.id,
      actorUserId: actor.userId,
    });
    inputKg = inputKg.plus(inp.roll.qtyKgActual.toString());
  }

  // Produce children.
  let outputKg = new Decimal(0);
  const initialState = childInitialState(order.operation);
  for (const spec of input.children) {
    const itemId = spec.itemId ?? order.targetItemId;
    const agingDays = await resolveItemAging(tx, itemId);
    const { roll } = await receiveRoll(tx, {
      companyId: actor.companyId,
      itemId,
      locationId: spec.locationId,
      dimensions: spec.dimensions,
      actualKg: spec.actualKg,
      initialState,
      agingReadyDate: childReCures(order.operation)
        ? agingReadyDate(now, agingDays)
        : null,
      at: now,
      reason: "CONVERT_IN",
      refType: "ConvertingOrder",
      refId: order.id,
      actorUserId: actor.userId,
    });
    // Link the child to this order (genealogy) and inherit the parents' QC-passed status.
    await tx.roll.update({
      where: { id: roll.id },
      data: { convertingOrderId: order.id, qcStatus: "PASSED" },
    });
    outputKg = outputKg.plus(new Decimal(spec.actualKg).toString());
  }

  const updated = await tx.convertingOrder.update({
    where: { id: order.id },
    data: {
      status: "CLOSED",
      inputKg: inputKg.toString(),
      outputKg: outputKg.toString(),
      scrapKg: input.scrapKg != null ? new Decimal(input.scrapKg).toString() : "0",
      trimKg: input.trimKg != null ? new Decimal(input.trimKg).toString() : "0",
      endedAt: now,
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "ConvertingOrder",
    entityId: order.id,
    action: "CLOSE",
    actorUserId: actor.userId,
    before: { status: "OPEN" },
    after: {
      status: "CLOSED",
      parents: inputs.length,
      children: input.children.length,
      outputKg: outputKg.toString(),
    },
  });
  return updated;
}

// --- cancel --------------------------------------------------------------------------

/** Cancel a converting order. An OPEN order simply releases its reserved parents
 *  (ALLOCATED → AVAILABLE). A CLOSED order reverses both sides: child SERIAL-INs (children →
 *  CANCELLED) and parent SERIAL-OUTs (parents → AVAILABLE). Nothing is deleted. */
export async function cancelConverting(
  tx: Tx,
  actor: Actor,
  orderId: string,
): Promise<ConvertingOrder> {
  requireAccess(actor, "PRODUCTION", "write");
  const order = await tx.convertingOrder.findFirst({
    where: { id: orderId, companyId: actor.companyId },
    include: { inputs: true, children: true },
  });
  if (!order) throw new AuthzError("converting order not found");
  if (order.status === "CANCELLED") {
    throw new ConvertingValidationError(["order is already cancelled"]);
  }

  if (order.status === "CLOSED") {
    // Reverse child SERIAL INs and mark children CANCELLED.
    for (const child of order.children) {
      const ins = await tx.stockLedger.findMany({
        where: {
          rollId: child.id,
          grain: "SERIAL",
          direction: "IN",
          reason: "CONVERT_IN",
          reversesLedgerId: null,
        },
      });
      for (const entry of ins)
        await reverse(tx, entry.id, actor.userId, `CV ${order.docNo} cancelled`);
      if (child.state !== "CANCELLED") {
        await tx.roll.update({ where: { id: child.id }, data: { state: "CANCELLED" } });
      }
    }
    // Reverse parent SERIAL OUTs and return parents to AVAILABLE.
    for (const inp of order.inputs) {
      const outs = await tx.stockLedger.findMany({
        where: {
          rollId: inp.rollId,
          grain: "SERIAL",
          direction: "OUT",
          reason: "CONVERT_OUT",
          reversesLedgerId: null,
        },
      });
      for (const entry of outs)
        await reverse(tx, entry.id, actor.userId, `CV ${order.docNo} cancelled`);
      await tx.roll.updateMany({
        where: { id: inp.rollId, state: "CONSUMED" },
        data: { state: "AVAILABLE" },
      });
    }
  } else {
    // OPEN: just release the reserved parents.
    for (const inp of order.inputs) {
      await tx.roll.updateMany({
        where: { id: inp.rollId, companyId: actor.companyId, state: "ALLOCATED" },
        data: { state: "AVAILABLE" },
      });
    }
  }

  const updated = await tx.convertingOrder.update({
    where: { id: order.id },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "ConvertingOrder",
    entityId: order.id,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: order.status },
    after: { status: "CANCELLED", docNo: order.docNo },
  });
  return updated;
}

// --- metrics & genealogy -------------------------------------------------------------

export interface ConvertingMetrics {
  inputKg: Decimal;
  outputKg: Decimal;
  scrapKg: Decimal;
  trimKg: Decimal;
  balanceVariance: Decimal;
}

/** Material metrics for an order: parents in, children/scrap/trim out, and the balance
 *  variance (input − output − scrap − trim) — a KPI, not an error. */
export async function convertingMetrics(
  tx: Tx,
  orderId: string,
): Promise<ConvertingMetrics> {
  const o = await tx.convertingOrder.findUniqueOrThrow({ where: { id: orderId } });
  const inputKg = new Decimal(o.inputKg.toString());
  const outputKg = new Decimal(o.outputKg.toString());
  const scrapKg = new Decimal(o.scrapKg.toString());
  const trimKg = new Decimal(o.trimKg.toString());
  return {
    inputKg,
    outputKg,
    scrapKg,
    trimKg,
    balanceVariance: materialBalance(inputKg, outputKg, scrapKg, trimKg),
  };
}

/** Trace a roll's genealogy: the converting order that produced it (with its parent rolls,
 *  each up to its extrusion lot), and any orders that later consumed it as a parent. */
export async function traceRoll(db: Tx, companyId: string, rollId: string) {
  return db.roll.findFirst({
    where: { id: rollId, companyId },
    include: {
      lot: true,
      item: true,
      convertingOrder: {
        include: { inputs: { include: { roll: { include: { lot: true } } } } },
      },
      convertingInputs: { include: { order: true } },
    },
  });
}
