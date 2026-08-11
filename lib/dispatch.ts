// lib/dispatch.ts — dispatch & tax invoice (spec S13).
// Turn AVAILABLE rolls into a shipment and a GST invoice: pick (allocate) rolls → dispatch
// note → invoice (CGST/SGST vs IGST by ship-to state, HSN, gapless FY numbers) → SERIAL-OUT
// postings that flip the rolls DISPATCHED. Genealogy (DispatchRoll → Roll → Lot) is preserved.
// Cancel-not-delete: a cancelled invoice keeps its number and reverses its stock (S3).
// This is the *document*; statutory books stay in Tally (CLAUDE.md).

import type { DispatchNote, Invoice, Prisma } from "@prisma/client";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { nextDocNumber } from "./doc-number.js";
import { allocateRolls, post, reverse } from "./stock-ledger.js";
import { writeAudit } from "./audit.js";
import {
  isIntraState,
  lineTaxableValuePaise,
  computeLineTax,
  sumInvoiceTotals,
  type InvoiceLineAmounts,
} from "./gst.js";
import { Decimal } from "./decimal.js";

type Tx = Prisma.TransactionClient;

export class DispatchValidationError extends Error {
  override name = "DispatchValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- create dispatch + pick rolls ----------------------------------------------------

export interface CreateDispatchInput {
  customerId: string;
  shipToId: string;
  rollIds: string[];
  transporter?: string | null;
  vehicleNo?: string | null;
  lrNo?: string | null;
  dispatchedAt?: Date;
  /** Logged override to ship still-curing / not-yet-available rolls (S12/S3). */
  override?: { reason: string };
}

/** Create an OPEN dispatch note and allocate its rolls (AVAILABLE → ALLOCATED). Only
 *  available, aging-ready rolls pick without an override (S3). */
export async function createDispatch(
  tx: Tx,
  actor: Actor,
  input: CreateDispatchInput,
): Promise<DispatchNote> {
  requireAccess(actor, "DISPATCH", "write");
  const errors: string[] = [];
  if (!input.customerId) errors.push("customer is required");
  if (!input.shipToId) errors.push("ship-to is required");
  if (!input.rollIds?.length) errors.push("at least one roll is required");
  if (errors.length) throw new DispatchValidationError(errors);

  // Ship-to must belong to the customer (and the customer to this company).
  const shipTo = await tx.shipToAddress.findFirst({
    where: {
      id: input.shipToId,
      customer: { id: input.customerId, companyId: actor.companyId },
    },
  });
  if (!shipTo)
    throw new DispatchValidationError(["ship-to does not belong to the customer"]);

  const docNo = await nextDocNumber(tx, actor.companyId, "DISPATCH_NOTE", {
    prefix: "DN",
    ...(input.dispatchedAt ? { now: input.dispatchedAt } : {}),
  });
  const note = await tx.dispatchNote.create({
    data: {
      companyId: actor.companyId,
      docNo,
      customerId: input.customerId,
      shipToId: input.shipToId,
      transporter: input.transporter ?? null,
      vehicleNo: input.vehicleNo ?? null,
      lrNo: input.lrNo ?? null,
      createdById: actor.userId,
    },
  });

  await pickRolls(tx, actor, note.id, input.rollIds, input.override);

  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "DispatchNote",
    entityId: note.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: {
      docNo: note.docNo,
      customerId: note.customerId,
      rolls: input.rollIds.length,
    },
  });
  return note;
}

/** Allocate rolls onto an OPEN dispatch note (AVAILABLE → ALLOCATED, S3), recording the
 *  specific rolls (genealogy). Throws if a roll is not available (unless overridden). */
export async function pickRolls(
  tx: Tx,
  actor: Actor,
  noteId: string,
  rollIds: string[],
  override?: { reason: string },
): Promise<void> {
  requireAccess(actor, "DISPATCH", "write");
  const note = await tx.dispatchNote.findFirst({
    where: { id: noteId, companyId: actor.companyId },
  });
  if (!note) throw new AuthzError("dispatch note not found");
  if (note.status !== "OPEN") {
    throw new DispatchValidationError([
      `dispatch ${note.docNo} is ${note.status}, not OPEN`,
    ]);
  }

  await allocateRolls(tx, actor.companyId, rollIds, {
    actorUserId: actor.userId,
    refType: "DispatchNote",
    refId: noteId,
    ...(override ? { override } : {}),
  });

  await tx.dispatchRoll.createMany({
    data: rollIds.map((rollId) => ({ dispatchNoteId: noteId, rollId })),
    skipDuplicates: true,
  });
}

// --- generate invoice ----------------------------------------------------------------

export interface GenerateInvoiceInput {
  /** Rate per billed unit (paise), keyed by itemId — one per distinct SKU on the note. */
  ratesPaise: Record<string, number>;
  invoiceDate?: Date;
}

/**
 * Dispatch the note and raise its GST invoice: post SERIAL-OUT for every picked roll (flipping
 * it DISPATCHED), then build one invoice line per SKU with tax split by ship-to state. Totals
 * round to the nearest rupee. Numbers are gapless per FY (S2).
 */
export async function generateInvoice(
  tx: Tx,
  actor: Actor,
  noteId: string,
  input: GenerateInvoiceInput,
): Promise<Invoice> {
  requireAccess(actor, "DISPATCH", "write");
  const note = await tx.dispatchNote.findFirst({
    where: { id: noteId, companyId: actor.companyId },
    include: {
      company: true,
      customer: true,
      shipTo: true,
      rolls: { include: { roll: { include: { item: true } } } },
    },
  });
  if (!note) throw new AuthzError("dispatch note not found");
  if (note.status !== "OPEN") {
    throw new DispatchValidationError([
      `dispatch ${note.docNo} is ${note.status}, not OPEN`,
    ]);
  }
  if (note.rolls.length === 0) {
    throw new DispatchValidationError(["dispatch has no rolls"]);
  }

  const sellerState = (note.company.gstin ?? "").slice(0, 2);
  if (!sellerState) {
    throw new DispatchValidationError([
      "company GSTIN is not set — cannot determine GST",
    ]);
  }
  const intra = isIntraState(sellerState, note.shipTo.gstStateCode);

  // Post SERIAL OUT for each roll and flip it DISPATCHED.
  for (const dr of note.rolls) {
    await post(tx, {
      grain: "SERIAL",
      direction: "OUT",
      companyId: actor.companyId,
      rollId: dr.rollId,
      reason: "DISPATCH",
      setRollState: "DISPATCHED",
      refType: "DispatchNote",
      refId: note.id,
      actorUserId: actor.userId,
    });
  }
  await tx.dispatchNote.update({
    where: { id: note.id },
    data: { status: "DISPATCHED", dispatchedAt: input.invoiceDate ?? new Date() },
  });

  // Group rolls by SKU → one invoice line each.
  const byItem = new Map<string, typeof note.rolls>();
  for (const dr of note.rolls) {
    const list = byItem.get(dr.roll.itemId) ?? [];
    list.push(dr);
    byItem.set(dr.roll.itemId, list);
  }

  const errors: string[] = [];
  const lineData: (InvoiceLineAmounts & {
    itemId: string;
    description: string;
    hsnCode: string | null;
    qtyKg: string;
    qtyM2: string;
    ratePaise: number;
    gstRatePct: string;
  })[] = [];

  for (const [itemId, group] of byItem) {
    const item = group[0]!.roll.item;
    const ratePaise = input.ratesPaise[itemId];
    if (ratePaise == null || !(ratePaise > 0)) {
      errors.push(`rate is required for ${item.code}`);
      continue;
    }
    if (item.gstRatePct == null) {
      errors.push(`${item.code} has no GST rate — set it on the item master`);
      continue;
    }
    const qtyKg = group.reduce(
      (s, dr) => s.plus(dr.roll.qtyKgActual.toString()),
      new Decimal(0),
    );
    const qtyM2 = group.reduce(
      (s, dr) => s.plus(dr.roll.qtyM2.toString()),
      new Decimal(0),
    );
    const billedQty = item.uomBase === "KG" ? qtyKg : qtyM2;
    const taxable = lineTaxableValuePaise(billedQty.toString(), ratePaise);
    const tax = computeLineTax(taxable, item.gstRatePct.toString(), intra);
    lineData.push({
      itemId,
      description: item.name,
      hsnCode: item.hsnCode,
      qtyKg: qtyKg.toString(),
      qtyM2: qtyM2.toString(),
      ratePaise,
      gstRatePct: item.gstRatePct.toString(),
      taxableValuePaise: taxable,
      ...tax,
    });
  }
  if (errors.length) throw new DispatchValidationError(errors);

  const totals = sumInvoiceTotals(lineData);
  const docNo = await nextDocNumber(tx, actor.companyId, "INVOICE", {
    prefix: "INV",
    ...(input.invoiceDate ? { now: input.invoiceDate } : {}),
  });

  // Receivables due date (S19): invoiceDate + customer credit days.
  const invoiceDate = input.invoiceDate ?? new Date();
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + (note.customer.creditDays ?? 0));

  const invoice = await tx.invoice.create({
    data: {
      companyId: actor.companyId,
      docNo,
      dispatchNoteId: note.id,
      customerId: note.customerId,
      shipToId: note.shipToId,
      ...(input.invoiceDate ? { invoiceDate: input.invoiceDate } : {}),
      dueDate,
      placeOfSupplyStateCode: note.shipTo.gstStateCode,
      taxableValuePaise: BigInt(totals.taxableValuePaise),
      cgstPaise: BigInt(totals.cgstPaise),
      sgstPaise: BigInt(totals.sgstPaise),
      igstPaise: BigInt(totals.igstPaise),
      roundOffPaise: BigInt(totals.roundOffPaise),
      totalPaise: BigInt(totals.totalPaise),
      status: "ISSUED",
      createdById: actor.userId,
      lines: {
        create: lineData.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          hsnCode: l.hsnCode,
          qtyKg: l.qtyKg,
          qtyM2: l.qtyM2,
          ratePaise: BigInt(l.ratePaise),
          gstRatePct: l.gstRatePct,
          taxableValuePaise: BigInt(l.taxableValuePaise),
          cgstPaise: BigInt(l.cgstPaise),
          sgstPaise: BigInt(l.sgstPaise),
          igstPaise: BigInt(l.igstPaise),
        })),
      },
    },
  });

  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Invoice",
    entityId: invoice.id,
    action: "ISSUE",
    actorUserId: actor.userId,
    after: {
      docNo: invoice.docNo,
      intraState: intra,
      totalPaise: totals.totalPaise,
      lines: lineData.length,
    },
  });
  return invoice;
}

// --- cancellation (reversal, keep the number) ----------------------------------------

/** Cancel an issued invoice: reverse each roll's SERIAL-OUT (stock returns, roll → AVAILABLE),
 *  cancel the invoice and its dispatch note. The document number is retained (S2/CLAUDE.md). */
export async function cancelInvoice(
  tx: Tx,
  actor: Actor,
  invoiceId: string,
): Promise<Invoice> {
  requireAccess(actor, "DISPATCH", "write");
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, companyId: actor.companyId },
    include: { dispatchNote: { include: { rolls: true } } },
  });
  if (!invoice) throw new AuthzError("invoice not found");
  if (invoice.status === "CANCELLED") {
    throw new DispatchValidationError(["invoice is already cancelled"]);
  }

  for (const dr of invoice.dispatchNote.rolls) {
    const out = await tx.stockLedger.findFirst({
      where: {
        rollId: dr.rollId,
        grain: "SERIAL",
        direction: "OUT",
        reason: "DISPATCH",
        reversesLedgerId: null,
      },
    });
    if (out) {
      const reversed = await tx.stockLedger.findUnique({
        where: { reversesLedgerId: out.id },
      });
      if (!reversed) {
        await reverse(tx, out.id, actor.userId, `invoice ${invoice.docNo} cancelled`);
      }
    }
    const roll = await tx.roll.findUnique({ where: { id: dr.rollId } });
    if (roll && roll.state === "DISPATCHED") {
      await tx.roll.update({ where: { id: dr.rollId }, data: { state: "AVAILABLE" } });
      await writeAudit(tx, {
        companyId: actor.companyId,
        entity: "Roll",
        entityId: dr.rollId,
        action: "STATE",
        actorUserId: actor.userId,
        before: { state: "DISPATCHED" },
        after: { state: "AVAILABLE", reason: `invoice ${invoice.docNo} cancelled` },
      });
    }
  }

  await tx.dispatchNote.update({
    where: { id: invoice.dispatchNoteId },
    data: { status: "CANCELLED" },
  });
  const updated = await tx.invoice.update({
    where: { id: invoiceId },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Invoice",
    entityId: invoiceId,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: "ISSUED" },
    after: { status: "CANCELLED", docNo: invoice.docNo },
  });
  return updated;
}

/** Cancel an OPEN dispatch note before it is invoiced: de-allocate its rolls
 *  (ALLOCATED → AVAILABLE) and mark it cancelled. An invoiced note must be cancelled via
 *  `cancelInvoice`. */
export async function cancelDispatch(
  tx: Tx,
  actor: Actor,
  noteId: string,
): Promise<DispatchNote> {
  requireAccess(actor, "DISPATCH", "write");
  const note = await tx.dispatchNote.findFirst({
    where: { id: noteId, companyId: actor.companyId },
    include: { rolls: true },
  });
  if (!note) throw new AuthzError("dispatch note not found");
  if (note.status === "CANCELLED") {
    throw new DispatchValidationError(["dispatch is already cancelled"]);
  }
  if (note.status === "DISPATCHED") {
    throw new DispatchValidationError([
      "dispatch is invoiced — cancel the invoice instead",
    ]);
  }

  for (const dr of note.rolls) {
    const res = await tx.roll.updateMany({
      where: { id: dr.rollId, companyId: actor.companyId, state: "ALLOCATED" },
      data: { state: "AVAILABLE" },
    });
    if (res.count > 0) {
      await writeAudit(tx, {
        companyId: actor.companyId,
        entity: "Roll",
        entityId: dr.rollId,
        action: "STATE",
        actorUserId: actor.userId,
        before: { state: "ALLOCATED" },
        after: { state: "AVAILABLE", reason: `dispatch ${note.docNo} cancelled` },
      });
    }
  }

  const updated = await tx.dispatchNote.update({
    where: { id: noteId },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "DispatchNote",
    entityId: noteId,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: note.status },
    after: { status: "CANCELLED", docNo: note.docNo },
  });
  return updated;
}

// --- genealogy -----------------------------------------------------------------------

/** Trace a dispatched roll back to its lot (and forward to its dispatch/invoice) — the chain
 *  required for complaint tracing (CLAUDE.md glossary). */
export async function traceRoll(db: Tx, companyId: string, rollId: string) {
  return db.roll.findFirst({
    where: { id: rollId, companyId },
    include: {
      lot: true,
      item: true,
      dispatchRolls: {
        include: { dispatchNote: { include: { invoice: true, customer: true } } },
      },
    },
  });
}
