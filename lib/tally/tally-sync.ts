// lib/tally/tally-sync.ts — Tally sync services (spec S24).
// The bridge across the CLAUDE.md boundary: invoices export OUT to Tally sales vouchers, receipts
// import IN as S19 receipts tagged source=TALLY. Idempotent (payloadHash out / externalRef in),
// every attempt logged and retryable, no ledger logic here — balances live in Tally. Money stays
// in paise (BigInt) internally, rendered to rupees only in the XML.

import { createHash } from "node:crypto";
import type { Invoice, Prisma } from "@prisma/client";
import { requireRole, AuthzError, type Actor } from "../rbac.js";
import { writeAudit } from "../audit.js";
import { recordReceipt } from "../receivables.js";
import { mockConnector, type TallyConnector, type InboundReceipt } from "./connector.js";

type Tx = Prisma.TransactionClient;

export class TallySyncError extends Error {
  override name = "TallySyncError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure XML ------------------------------------------------------------------------

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** paise → rupee string with 2 decimals (Tally amounts are in rupees). */
export function paiseToRupees(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const rupees = abs / 100n;
  const p = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${rupees}.${p}`;
}

/** rupee string → paise (BigInt). Pure. */
export function rupeesToPaise(rupees: string): bigint {
  const [whole = "0", frac = ""] = rupees.trim().replace(/,/g, "").split(".");
  const paiseFrac = (frac + "00").slice(0, 2);
  const sign = whole.startsWith("-") ? -1n : 1n;
  const w = BigInt(whole.replace("-", "") || "0");
  return sign * (w * 100n + BigInt(paiseFrac || "0"));
}

interface InvoiceForXml {
  docNo: string;
  invoiceDate: Date;
  taxableValuePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  igstPaise: bigint;
  totalPaise: bigint;
}

/** Render a Tally sales-voucher XML for an invoice + the party ledger name. Pure — the customer
 *  (debit) is the party ledger; sales + GST are credit ledgers. Well-formed and escaped. */
export function buildSalesVoucherXml(invoice: InvoiceForXml, ledgerName: string): string {
  const date = invoice.invoiceDate.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD (Tally date format)
  const party = xmlEscape(ledgerName);
  const taxLedger = (name: string, paise: bigint) =>
    paise > 0n
      ? `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${name}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${paiseToRupees(paise)}</AMOUNT></ALLLEDGERENTRIES.LIST>`
      : "";
  return (
    `<TALLYMESSAGE><VOUCHER VCHTYPE="Sales" ACTION="Create">` +
    `<DATE>${date}</DATE>` +
    `<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${xmlEscape(invoice.docNo)}</VOUCHERNUMBER>` +
    `<PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${party}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${paiseToRupees(invoice.totalPaise)}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${paiseToRupees(invoice.taxableValuePaise)}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
    taxLedger("CGST", invoice.cgstPaise) +
    taxLedger("SGST", invoice.sgstPaise) +
    taxLedger("IGST", invoice.igstPaise) +
    `</VOUCHER></TALLYMESSAGE>`
  );
}

/** Parse a Tally receipt voucher XML into a normalised inbound receipt. Pure — pulls the voucher
 *  GUID, party ledger, amount, reference and date via tag extraction. */
export function parseReceiptVoucher(xml: string): InboundReceipt {
  const tag = (name: string): string | null => {
    const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
    return m ? m[1]!.trim() : null;
  };
  const externalRef = tag("VOUCHERGUID") ?? tag("VOUCHERNUMBER") ?? "";
  const ledgerName = tag("PARTYLEDGERNAME") ?? tag("LEDGERNAME") ?? "";
  const amount = tag("AMOUNT") ?? "0";
  const dateStr = tag("DATE"); // YYYYMMDD
  const receivedAt = dateStr
    ? new Date(
        `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T00:00:00Z`,
      )
    : new Date();
  return {
    externalRef,
    ledgerName,
    amountPaise: rupeesToPaise(amount.replace("-", "")),
    reference: tag("REFERENCE"),
    receivedAt,
  };
}

// --- helpers -------------------------------------------------------------------------

function hashXml(xml: string): string {
  return createHash("sha256").update(xml).digest("hex");
}

async function resolveLedgerName(
  tx: Tx,
  companyId: string,
  customerId: string,
): Promise<string> {
  const map = await tx.customerTallyMap.findUnique({ where: { customerId } });
  if (map) return map.tallyLedgerName;
  const customer = await tx.customer.findFirstOrThrow({
    where: { id: customerId, companyId },
  });
  return customer.name;
}

// --- outbound: invoices → Tally ------------------------------------------------------

export interface ExportOptions {
  connector?: TallyConnector;
}

/**
 * Export an invoice to Tally as a sales voucher (or a cancellation voucher for a cancelled one),
 * MOCK connector by default. Idempotent — an invoice already synced with the same payload hash is
 * a no-op returning the existing row. ERP is the source of truth for invoices; the export is
 * create-only in Tally. ACCOUNTS/ADMIN only.
 */
export async function exportInvoice(
  tx: Tx,
  actor: Actor,
  invoiceId: string,
  opts: ExportOptions = {},
): Promise<{ status: string; externalRef: string | null }> {
  requireRole(actor, "ACCOUNTS", "ADMIN");
  const connector = opts.connector ?? mockConnector;
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, companyId: actor.companyId },
  });
  if (!invoice) throw new AuthzError("invoice not found");
  if (invoice.status === "DRAFT") {
    throw new TallySyncError([`invoice ${invoice.docNo} is a draft — nothing to export`]);
  }

  const ledgerName = await resolveLedgerName(tx, actor.companyId, invoice.customerId);
  const isCancellation = invoice.status === "CANCELLED";
  const xml = isCancellation
    ? `<TALLYMESSAGE><VOUCHER VCHTYPE="Sales" ACTION="Cancel"><VOUCHERNUMBER>${xmlEscape(invoice.docNo)}</VOUCHERNUMBER></VOUCHER></TALLYMESSAGE>`
    : buildSalesVoucherXml(invoice, ledgerName);
  const payloadHash = hashXml(xml);

  // Idempotency: already synced with this exact payload.
  const existing = await tx.tallySync.findFirst({
    where: {
      companyId: actor.companyId,
      entityType: "INVOICE",
      entityId: invoice.id,
      payloadHash,
      status: { in: ["SENT", "ACK"] },
    },
  });
  if (existing) return { status: "SKIPPED", externalRef: existing.externalRef };

  try {
    const ack = isCancellation
      ? await connector.pushCancellation(await priorRef(tx, invoice.id), invoice.docNo)
      : await connector.pushSalesVoucher({ xml, payloadHash });
    const row = await tx.tallySync.create({
      data: {
        companyId: actor.companyId,
        entityType: "INVOICE",
        entityId: invoice.id,
        direction: "OUT",
        status: "ACK",
        externalRef: ack.externalRef,
        payloadHash,
        attempts: 1,
      },
    });
    await writeAudit(tx, {
      companyId: actor.companyId,
      entity: "Invoice",
      entityId: invoice.id,
      action: isCancellation ? "TALLY_CANCEL" : "TALLY_EXPORT",
      actorUserId: actor.userId,
      after: { externalRef: ack.externalRef, docNo: invoice.docNo },
    });
    return { status: row.status, externalRef: row.externalRef };
  } catch (err) {
    await tx.tallySync.create({
      data: {
        companyId: actor.companyId,
        entityType: "INVOICE",
        entityId: invoice.id,
        direction: "OUT",
        status: "ERROR",
        payloadHash,
        attempts: 1,
        lastError: err instanceof Error ? err.message : String(err),
      },
    });
    throw new TallySyncError([`export failed: ${(err as Error).message}`]);
  }
}

async function priorRef(tx: Tx, invoiceId: string): Promise<string> {
  const prior = await tx.tallySync.findFirst({
    where: {
      entityType: "INVOICE",
      entityId: invoiceId,
      status: "ACK",
      direction: "OUT",
      externalRef: { not: null },
    },
    orderBy: { at: "desc" },
  });
  return prior?.externalRef ?? "";
}

/** Issued invoices not yet ACK-exported to Tally. */
export async function pendingInvoiceExports(
  db: Tx,
  companyId: string,
): Promise<Invoice[]> {
  const synced = await db.tallySync.findMany({
    where: { companyId, entityType: "INVOICE", status: "ACK" },
    select: { entityId: true },
  });
  const done = new Set(synced.map((s) => s.entityId));
  const invoices = await db.invoice.findMany({
    where: { companyId, status: "ISSUED" },
    orderBy: { createdAt: "desc" },
  });
  return invoices.filter((i) => !done.has(i.id));
}

// --- inbound: Tally receipts → S19 ---------------------------------------------------

export interface ImportOptions {
  connector?: TallyConnector;
  since?: Date | null;
}
export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

/**
 * Import receipt vouchers from Tally as S19 receipts tagged source=TALLY, keeping ageing and
 * outstanding consistent (reuses `recordReceipt`). Idempotent — a voucher already imported (by
 * externalRef) is skipped. An unmatched ledger is logged as an ERROR row, never dropped.
 * ACCOUNTS/ADMIN only.
 */
export async function importReceipts(
  tx: Tx,
  actor: Actor,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  requireRole(actor, "ACCOUNTS", "ADMIN");
  const connector = opts.connector ?? mockConnector;
  const inbound = await connector.pullReceipts(opts.since ?? null);
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const r of inbound) {
    const seen = await tx.tallySync.findFirst({
      where: {
        companyId: actor.companyId,
        entityType: "RECEIPT",
        externalRef: r.externalRef,
      },
    });
    if (seen) {
      skipped += 1;
      continue;
    }

    // Map the Tally ledger back to a customer (explicit map first, then name).
    const mapped = await tx.customerTallyMap.findFirst({
      where: { companyId: actor.companyId, tallyLedgerName: r.ledgerName },
    });
    const customer =
      (mapped
        ? await tx.customer.findUnique({ where: { id: mapped.customerId } })
        : null) ??
      (await tx.customer.findFirst({
        where: { companyId: actor.companyId, name: r.ledgerName },
      }));

    if (!customer) {
      await tx.tallySync.create({
        data: {
          companyId: actor.companyId,
          entityType: "RECEIPT",
          direction: "IN",
          status: "ERROR",
          externalRef: r.externalRef,
          attempts: 1,
          lastError: `no customer for Tally ledger "${r.ledgerName}"`,
        },
      });
      errors += 1;
      continue;
    }

    const receipt = await recordReceipt(tx, actor, {
      customerId: customer.id,
      amountPaise: r.amountPaise,
      source: "TALLY",
      reference: r.reference,
      receivedAt: r.receivedAt,
    });
    await tx.tallySync.create({
      data: {
        companyId: actor.companyId,
        entityType: "RECEIPT",
        entityId: receipt.id,
        direction: "IN",
        status: "ACK",
        externalRef: r.externalRef,
        attempts: 1,
      },
    });
    imported += 1;
  }

  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "TallySync",
    entityId: "receipts",
    action: "TALLY_IMPORT",
    actorUserId: actor.userId,
    after: { imported, skipped, errors },
  });
  return { imported, skipped, errors };
}

// --- retry ---------------------------------------------------------------------------

/** Re-attempt a failed outbound export. ACCOUNTS/ADMIN only. */
export async function retry(
  tx: Tx,
  actor: Actor,
  syncId: string,
  opts: ExportOptions = {},
): Promise<{ status: string; externalRef: string | null }> {
  requireRole(actor, "ACCOUNTS", "ADMIN");
  const row = await tx.tallySync.findFirst({
    where: { id: syncId, companyId: actor.companyId },
  });
  if (!row) throw new AuthzError("sync row not found");
  if (row.entityType !== "INVOICE" || !row.entityId) {
    throw new TallySyncError(["only failed invoice exports are retryable here"]);
  }
  return exportInvoice(tx, actor, row.entityId, opts);
}
