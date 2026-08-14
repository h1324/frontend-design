// lib/einvoice/einvoice.ts — e-invoice (IRN) & e-way-bill services (spec S23).
// Populate the S13 invoice's IRN/signed-QR/EWB fields via a pluggable provider (MOCK default).
// Idempotent generation, threshold gating, a cancel window, and an attempt log for every call —
// nothing is silently dropped. DISPATCH-write gated, audited. No secrets here (CLAUDE.md).

import { createHash } from "node:crypto";
import type { Invoice, Prisma } from "@prisma/client";
import { requireAccess, AuthzError, type Actor } from "../rbac.js";
import { writeAudit } from "../audit.js";
import { mockProvider, type EInvoiceProvider, type IrpPayload } from "./provider.js";

type Tx = Prisma.TransactionClient;

export class EInvoiceError extends Error {
  override name = "EInvoiceError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure --------------------------------------------------------------------------

export interface Thresholds {
  /** Minimum invoice total (paise) that requires an IRN. Default 0 = always eligible. */
  einvoiceMinPaise: bigint;
  /** Minimum consignment value (paise) that requires an e-way bill. Default ₹50,000. */
  ewbMinPaise: bigint;
}
export const DEFAULT_THRESHOLDS: Thresholds = {
  einvoiceMinPaise: 0n,
  ewbMinPaise: 5_000_000n,
};

export const DEFAULT_CANCEL_WINDOW_HOURS = 24;

/** Is this invoice at/above the e-invoice threshold? Pure. */
export function isEInvoiceRequired(
  totalPaise: bigint,
  t: Thresholds = DEFAULT_THRESHOLDS,
): boolean {
  return totalPaise >= t.einvoiceMinPaise;
}

/** Is this consignment at/above the e-way-bill threshold? Pure. */
export function isEwayBillRequired(
  totalPaise: bigint,
  t: Thresholds = DEFAULT_THRESHOLDS,
): boolean {
  return totalPaise >= t.ewbMinPaise;
}

/** Is `now` still inside the IRN cancel window that opened at `ackDate`? Pure. */
export function withinCancelWindow(
  ackDate: Date,
  now: Date,
  hours: number = DEFAULT_CANCEL_WINDOW_HOURS,
): boolean {
  return now.getTime() - ackDate.getTime() <= hours * 3_600_000;
}

type InvoiceForPayload = Invoice & {
  customer: { gstin: string | null };
  lines: {
    itemId: string;
    description: string;
    hsnCode: string | null;
    qtyKg: Prisma.Decimal;
    qtyM2: Prisma.Decimal;
    gstRatePct: Prisma.Decimal;
    taxableValuePaise: bigint;
  }[];
};

/** Build the normalised IRP payload from an invoice + the seller (company) GSTIN. Pure — no DB,
 *  no secrets. The real adapter maps this onto the GSP's schema. */
export function buildIrpPayload(
  invoice: InvoiceForPayload,
  sellerGstin: string,
): IrpPayload {
  return {
    docNo: invoice.docNo,
    docDate: invoice.invoiceDate.toLocaleDateString("en-GB"),
    sellerGstin,
    buyerGstin: invoice.customer.gstin ?? null,
    placeOfSupply: invoice.placeOfSupplyStateCode,
    taxableValuePaise: invoice.taxableValuePaise.toString(),
    totalPaise: invoice.totalPaise.toString(),
    items: invoice.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      hsn: l.hsnCode,
      // Billed quantity uses m² for foam; kg is carried too, but the IRP line qty is one number.
      qty: l.qtyM2.toString(),
      taxableValuePaise: l.taxableValuePaise.toString(),
      gstRatePct: l.gstRatePct.toString(),
    })),
  };
}

function payloadHash(payload: IrpPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// --- services ----------------------------------------------------------------------

async function loadInvoice(tx: Tx, actor: Actor, invoiceId: string) {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, companyId: actor.companyId },
    include: { customer: true, company: true, lines: true },
  });
  if (!invoice) throw new AuthzError("invoice not found");
  return invoice;
}

export interface GenerateIrnOptions {
  provider?: EInvoiceProvider;
  thresholds?: Thresholds;
  now?: Date;
}

/**
 * Generate an IRN for an issued invoice via the IRP (MOCK default). Idempotent — an invoice
 * already carrying an IRN returns unchanged. Below the e-invoice threshold it is left NONE, not
 * submitted. Every attempt writes an `EInvoiceLog`. DISPATCH-write.
 */
export async function generateIrn(
  tx: Tx,
  actor: Actor,
  invoiceId: string,
  opts: GenerateIrnOptions = {},
): Promise<Invoice> {
  requireAccess(actor, "DISPATCH", "write");
  const provider = opts.provider ?? mockProvider;
  const now = opts.now ?? new Date();
  const invoice = await loadInvoice(tx, actor, invoiceId);

  if (invoice.status !== "ISSUED") {
    throw new EInvoiceError([
      `invoice ${invoice.docNo} is ${invoice.status}, not ISSUED`,
    ]);
  }
  if (invoice.irn) return invoice; // idempotent no-op

  if (!isEInvoiceRequired(invoice.totalPaise, opts.thresholds)) {
    return invoice; // below threshold — stays einvoiceStatus NONE, not submitted
  }

  const sellerGstin = invoice.company.gstin ?? "";
  if (!sellerGstin) throw new EInvoiceError(["company GSTIN is not set"]);
  const payload = buildIrpPayload(invoice, sellerGstin);
  const requestHash = payloadHash(payload);

  let result;
  try {
    result = await provider.generateIrn(payload, now);
  } catch (err) {
    await logAttempt(tx, actor, invoice.id, "GEN_IRN", provider.name, requestHash, {
      status: "ERROR",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new EInvoiceError([`IRN generation failed: ${(err as Error).message}`]);
  }

  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      irn: result.irn,
      signedQr: result.signedQr,
      ackNo: result.ackNo,
      ackDate: result.ackDate,
      einvoiceStatus: "GENERATED",
    },
  });
  await logAttempt(tx, actor, invoice.id, "GEN_IRN", provider.name, requestHash, {
    status: "OK",
    responseRef: result.irn,
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Invoice",
    entityId: invoice.id,
    action: "EINVOICE_GEN",
    actorUserId: actor.userId,
    after: { irn: result.irn, ackNo: result.ackNo },
  });
  return updated;
}

export interface GenerateEwbOptions extends GenerateIrnOptions {
  distanceKm?: number;
}

/** Generate an e-way bill for an invoice (MOCK default). Requires an IRN and a consignment at/
 *  above the EWB threshold; idempotent if one already exists. DISPATCH-write. */
export async function generateEwayBill(
  tx: Tx,
  actor: Actor,
  invoiceId: string,
  opts: GenerateEwbOptions = {},
): Promise<Invoice> {
  requireAccess(actor, "DISPATCH", "write");
  const provider = opts.provider ?? mockProvider;
  const now = opts.now ?? new Date();
  const invoice = await loadInvoice(tx, actor, invoiceId);

  if (invoice.status !== "ISSUED") {
    throw new EInvoiceError([
      `invoice ${invoice.docNo} is ${invoice.status}, not ISSUED`,
    ]);
  }
  if (!invoice.irn) throw new EInvoiceError(["generate the IRN before the e-way bill"]);
  if (invoice.ewbNo) return invoice; // idempotent
  if (!isEwayBillRequired(invoice.totalPaise, opts.thresholds)) {
    throw new EInvoiceError(["consignment is below the e-way-bill threshold"]);
  }

  const sellerGstin = invoice.company.gstin ?? "";
  const payload = buildIrpPayload(invoice, sellerGstin);
  const requestHash = payloadHash(payload);
  const distanceKm = opts.distanceKm ?? 0;

  let result;
  try {
    result = await provider.generateEwayBill(payload, distanceKm, now);
  } catch (err) {
    await logAttempt(tx, actor, invoice.id, "GEN_EWB", provider.name, requestHash, {
      status: "ERROR",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new EInvoiceError([`e-way bill failed: ${(err as Error).message}`]);
  }

  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: { ewbNo: result.ewbNo, ewbValidTill: result.validTill },
  });
  await logAttempt(tx, actor, invoice.id, "GEN_EWB", provider.name, requestHash, {
    status: "OK",
    responseRef: result.ewbNo,
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Invoice",
    entityId: invoice.id,
    action: "EWB_GEN",
    actorUserId: actor.userId,
    after: { ewbNo: result.ewbNo, validTill: result.validTill.toISOString() },
  });
  return updated;
}

export interface CancelIrnOptions extends GenerateIrnOptions {
  reason: string;
  cancelWindowHours?: number;
}

/** Cancel an invoice's IRN within the statutory window (24h default). Clears the IRN/QR/EWB and
 *  marks the invoice CANCELLED for e-invoicing; outside the window it is refused (use a credit
 *  note via S13). DISPATCH-write. */
export async function cancelIrn(
  tx: Tx,
  actor: Actor,
  invoiceId: string,
  opts: CancelIrnOptions,
): Promise<Invoice> {
  requireAccess(actor, "DISPATCH", "write");
  const provider = opts.provider ?? mockProvider;
  const now = opts.now ?? new Date();
  const invoice = await loadInvoice(tx, actor, invoiceId);

  if (invoice.einvoiceStatus !== "GENERATED" || !invoice.irn) {
    throw new EInvoiceError(["no active IRN to cancel"]);
  }
  if (!opts.reason?.trim()) throw new EInvoiceError(["a cancel reason is required"]);
  if (
    !invoice.ackDate ||
    !withinCancelWindow(invoice.ackDate, now, opts.cancelWindowHours)
  ) {
    throw new EInvoiceError([
      "outside the IRN cancel window — raise a credit note instead",
    ]);
  }

  const requestHash = createHash("sha256").update(`cancel|${invoice.irn}`).digest("hex");
  try {
    await provider.cancelIrn(invoice.irn, opts.reason.trim());
  } catch (err) {
    await logAttempt(tx, actor, invoice.id, "CANCEL_IRN", provider.name, requestHash, {
      status: "ERROR",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new EInvoiceError([`IRN cancel failed: ${(err as Error).message}`]);
  }

  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      irn: null,
      signedQr: null,
      ackNo: null,
      ackDate: null,
      ewbNo: null,
      ewbValidTill: null,
      einvoiceStatus: "CANCELLED",
    },
  });
  await logAttempt(tx, actor, invoice.id, "CANCEL_IRN", provider.name, requestHash, {
    status: "OK",
    responseRef: opts.reason.trim(),
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Invoice",
    entityId: invoice.id,
    action: "EINVOICE_CANCEL",
    actorUserId: actor.userId,
    before: { irn: invoice.irn },
    after: { einvoiceStatus: "CANCELLED", reason: opts.reason.trim() },
  });
  return updated;
}

async function logAttempt(
  tx: Tx,
  actor: Actor,
  invoiceId: string,
  action: "GEN_IRN" | "CANCEL_IRN" | "GEN_EWB" | "CANCEL_EWB",
  provider: string,
  requestHash: string,
  outcome: {
    status: "OK" | "ERROR";
    responseRef?: string;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<void> {
  await tx.eInvoiceLog.create({
    data: {
      companyId: actor.companyId,
      invoiceId,
      action,
      provider,
      status: outcome.status,
      requestHash,
      responseRef: outcome.responseRef ?? null,
      errorCode: outcome.errorCode ?? null,
      errorMessage: outcome.errorMessage ?? null,
    },
  });
}
