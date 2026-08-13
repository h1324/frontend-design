// lib/receivables.ts — receivables ageing & credit control (spec S19).
// A credit-control VIEW, not an accounting ledger — the statutory books stay in Tally
// (CLAUDE.md). Outstanding = issued invoices − posted receipts; ageing buckets a customer's
// unsettled invoice balances by due date. Receipts are recorded here only to compute
// outstanding/ageing for the S18 credit check and tier scoring; they never post to a ledger,
// and are reversible by cancellation, never edited. Money in paise (BigInt); numbers gapless
// per FY (S2); everything audited. All maths on integer paise — no float (CLAUDE.md rule 2).

import type { Prisma, ReceiptMode, ReceiptSource, Receipt } from "@prisma/client";
import { requireAccess, requireRole, AuthzError, type Actor } from "./rbac.js";
import { nextDocNumber } from "./doc-number.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

export class ReceivablesValidationError extends Error {
  override name = "ReceivablesValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

// --- pure ageing maths ---------------------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar day number (days since epoch, shifted to IST). Pure. */
function istDayNumber(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / 86_400_000);
}

/** Whole days a due date is overdue as of `asOf`, in IST. ≤ 0 means not yet due. Pure. */
export function daysOverdue(dueDate: Date, asOf: Date): number {
  return istDayNumber(asOf) - istDayNumber(dueDate);
}

export type AgeingBucket = "current" | "d0_30" | "d31_60" | "d61_90" | "d90plus";

export const AGEING_BUCKETS: AgeingBucket[] = [
  "current",
  "d0_30",
  "d31_60",
  "d61_90",
  "d90plus",
];

export const AGEING_BUCKET_LABEL: Record<AgeingBucket, string> = {
  current: "Current",
  d0_30: "0–30",
  d31_60: "31–60",
  d61_90: "61–90",
  d90plus: "90+",
};

/** Which ageing bucket a due date falls in as of `asOf` (spec S19 default boundaries). Pure. */
export function ageingBucketKey(dueDate: Date, asOf: Date): AgeingBucket {
  const od = daysOverdue(dueDate, asOf);
  if (od <= 0) return "current";
  if (od <= 30) return "d0_30";
  if (od <= 60) return "d31_60";
  if (od <= 90) return "d61_90";
  return "d90plus";
}

export interface AgeingRow {
  remainingPaise: bigint;
  dueDate: Date;
}
export type AgeingTotals = Record<AgeingBucket, bigint> & { total: bigint };

/** Sum unsettled invoice balances into ageing buckets by due date. Pure. */
export function bucketReceivables(rows: AgeingRow[], asOf: Date): AgeingTotals {
  const out: AgeingTotals = {
    current: 0n,
    d0_30: 0n,
    d31_60: 0n,
    d61_90: 0n,
    d90plus: 0n,
    total: 0n,
  };
  for (const r of rows) {
    if (r.remainingPaise <= 0n) continue;
    const key = ageingBucketKey(r.dueDate, asOf);
    out[key] += r.remainingPaise;
    out.total += r.remainingPaise;
  }
  return out;
}

/** Would this allocation push a receipt's allocated total past its amount? Pure. */
export function wouldOverAllocateReceipt(
  receiptAmountPaise: bigint,
  alreadyAllocatedPaise: bigint,
  newAmountPaise: bigint,
): boolean {
  return alreadyAllocatedPaise + newAmountPaise > receiptAmountPaise;
}

/** Would this allocation settle an invoice beyond its total? Pure. */
export function wouldOverSettleInvoice(
  invoiceTotalPaise: bigint,
  alreadySettledPaise: bigint,
  newAmountPaise: bigint,
): boolean {
  return alreadySettledPaise + newAmountPaise > invoiceTotalPaise;
}

// --- outstanding & ageing (read) -----------------------------------------------------

/** Total open receivable for a customer, in paise: Σ ISSUED invoice totals − Σ POSTED receipt
 *  amounts (recorded receipts, allocated or on-account). This is the figure the S18 credit
 *  check and tier scoring consume. May be negative when a customer is in advance/credit. */
export async function customerOutstandingPaise(
  db: Tx,
  companyId: string,
  customerId: string,
): Promise<bigint> {
  const [inv, rec] = await Promise.all([
    db.invoice.aggregate({
      where: { companyId, customerId, status: "ISSUED" },
      _sum: { totalPaise: true },
    }),
    db.receipt.aggregate({
      where: { companyId, customerId, status: "POSTED" },
      _sum: { amountPaise: true },
    }),
  ]);
  return (inv._sum.totalPaise ?? 0n) - (rec._sum.amountPaise ?? 0n);
}

export interface CustomerAgeing {
  buckets: AgeingTotals;
  /** Unallocated posted-receipt amount ("on account") — a credit not tied to any invoice. */
  onAccountPaise: bigint;
  /** Net outstanding = Σ bucket balances − on-account credit (== customerOutstandingPaise). */
  outstandingPaise: bigint;
}

/** Age a customer's unsettled ISSUED-invoice balances into buckets by due date, and surface any
 *  on-account credit. `dueDate` falls back to invoiceDate + creditDays for legacy invoices. */
export async function customerAgeing(
  db: Tx,
  companyId: string,
  customerId: string,
  asOf: Date = new Date(),
): Promise<CustomerAgeing> {
  const [customer, invoices, receipts] = await Promise.all([
    db.customer.findFirstOrThrow({ where: { id: customerId, companyId } }),
    db.invoice.findMany({
      where: { companyId, customerId, status: "ISSUED" },
    }),
    db.receipt.aggregate({
      where: { companyId, customerId, status: "POSTED" },
      _sum: { amountPaise: true },
    }),
  ]);

  const rows: AgeingRow[] = invoices.map((inv) => {
    const due =
      inv.dueDate ??
      new Date(inv.invoiceDate.getTime() + (customer.creditDays ?? 0) * 86_400_000);
    return { remainingPaise: inv.totalPaise - inv.amountSettledPaise, dueDate: due };
  });
  const buckets = bucketReceivables(rows, asOf);

  const totalReceipts = receipts._sum.amountPaise ?? 0n;
  const totalSettled = invoices.reduce((s, i) => s + i.amountSettledPaise, 0n);
  const onAccountPaise = totalReceipts - totalSettled; // unallocated posted receipts

  return {
    buckets,
    onAccountPaise,
    outstandingPaise: buckets.total - onAccountPaise,
  };
}

// --- receipts ------------------------------------------------------------------------

export interface AllocationInput {
  invoiceId: string;
  amountPaise: bigint | number;
}
export interface RecordReceiptInput {
  customerId: string;
  amountPaise: bigint | number;
  mode?: ReceiptMode;
  reference?: string | null;
  source?: ReceiptSource;
  receivedAt?: Date;
  /** Optional allocations to apply immediately; the rest stays on account. */
  allocations?: AllocationInput[];
}

/** Record a customer receipt (POSTED) and optionally allocate it to invoices. Gapless RCT/FY
 *  number. Write is ACCOUNTS/ADMIN only (spec S19). */
export async function recordReceipt(
  tx: Tx,
  actor: Actor,
  input: RecordReceiptInput,
): Promise<Receipt> {
  requireAccess(actor, "RECEIVABLES", "write");
  requireRole(actor, "ACCOUNTS", "ADMIN");
  const amount = BigInt(input.amountPaise);
  const errors: string[] = [];
  if (!input.customerId) errors.push("customer is required");
  if (amount <= 0n) errors.push("amount must be greater than zero");
  if (errors.length) throw new ReceivablesValidationError(errors);

  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, companyId: actor.companyId },
  });
  if (!customer) throw new ReceivablesValidationError(["customer not found"]);

  const docNo = await nextDocNumber(tx, actor.companyId, "RECEIPT", {
    prefix: "RCT",
    ...(input.receivedAt ? { now: input.receivedAt } : {}),
  });
  const receipt = await tx.receipt.create({
    data: {
      companyId: actor.companyId,
      docNo,
      customerId: input.customerId,
      amountPaise: amount,
      mode: input.mode ?? "BANK",
      reference: input.reference ?? null,
      source: input.source ?? "MANUAL",
      ...(input.receivedAt ? { receivedAt: input.receivedAt } : {}),
      createdById: actor.userId,
    },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Receipt",
    entityId: receipt.id,
    action: "RECORD",
    actorUserId: actor.userId,
    after: {
      docNo: receipt.docNo,
      customerId: receipt.customerId,
      amountPaise: amount.toString(),
    },
  });

  if (input.allocations?.length) {
    await allocateReceipt(tx, actor, receipt.id, input.allocations);
  }
  return receipt;
}

/** Apply (or add to) a receipt's allocations to specific invoices. Rejects allocating more
 *  than the receipt's amount, or settling an invoice beyond its total. Maintains each invoice's
 *  `amountSettledPaise`. ACCOUNTS/ADMIN only. */
export async function allocateReceipt(
  tx: Tx,
  actor: Actor,
  receiptId: string,
  allocations: AllocationInput[],
): Promise<void> {
  requireAccess(actor, "RECEIVABLES", "write");
  requireRole(actor, "ACCOUNTS", "ADMIN");
  const receipt = await tx.receipt.findFirst({
    where: { id: receiptId, companyId: actor.companyId },
    include: { allocations: true },
  });
  if (!receipt) throw new AuthzError("receipt not found");
  if (receipt.status !== "POSTED") {
    throw new ReceivablesValidationError([
      `receipt ${receipt.docNo} is ${receipt.status}`,
    ]);
  }
  if (!allocations?.length) {
    throw new ReceivablesValidationError(["at least one allocation is required"]);
  }

  let allocatedSoFar = receipt.allocations.reduce((s, a) => s + a.amountPaise, 0n);

  for (const alloc of allocations) {
    const amount = BigInt(alloc.amountPaise);
    if (amount <= 0n) {
      throw new ReceivablesValidationError([
        "allocation amount must be greater than zero",
      ]);
    }
    if (wouldOverAllocateReceipt(receipt.amountPaise, allocatedSoFar, amount)) {
      throw new ReceivablesValidationError([
        `allocation exceeds receipt ${receipt.docNo} unallocated balance`,
      ]);
    }
    const invoice = await tx.invoice.findFirst({
      where: {
        id: alloc.invoiceId,
        companyId: actor.companyId,
        customerId: receipt.customerId,
        status: "ISSUED",
      },
    });
    if (!invoice) {
      throw new ReceivablesValidationError([
        "invoice not found, not this customer's, or not open",
      ]);
    }
    // Fold into any existing allocation for the same (receipt, invoice) pair.
    const existing = receipt.allocations.find((a) => a.invoiceId === alloc.invoiceId);
    const existingAmount = existing?.amountPaise ?? 0n;
    if (
      wouldOverSettleInvoice(
        invoice.totalPaise,
        invoice.amountSettledPaise - existingAmount,
        existingAmount + amount,
      )
    ) {
      throw new ReceivablesValidationError([
        `allocation would over-settle invoice ${invoice.docNo}`,
      ]);
    }

    if (existing) {
      await tx.receiptAllocation.update({
        where: { id: existing.id },
        data: { amountPaise: existing.amountPaise + amount },
      });
    } else {
      await tx.receiptAllocation.create({
        data: { receiptId: receipt.id, invoiceId: invoice.id, amountPaise: amount },
      });
    }
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountSettledPaise: invoice.amountSettledPaise + amount },
    });
    allocatedSoFar += amount;
  }

  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Receipt",
    entityId: receipt.id,
    action: "ALLOCATE",
    actorUserId: actor.userId,
    after: { allocations: allocations.length, allocatedPaise: allocatedSoFar.toString() },
  });
}

/** Cancel a receipt: unwind its allocations (decrement each invoice's settled amount) and mark
 *  it CANCELLED, keeping the number (S2). A cancelled receipt no longer reduces outstanding.
 *  ACCOUNTS/ADMIN only. */
export async function cancelReceipt(
  tx: Tx,
  actor: Actor,
  receiptId: string,
): Promise<Receipt> {
  requireAccess(actor, "RECEIVABLES", "write");
  requireRole(actor, "ACCOUNTS", "ADMIN");
  const receipt = await tx.receipt.findFirst({
    where: { id: receiptId, companyId: actor.companyId },
    include: { allocations: true },
  });
  if (!receipt) throw new AuthzError("receipt not found");
  if (receipt.status === "CANCELLED") {
    throw new ReceivablesValidationError(["receipt is already cancelled"]);
  }

  for (const a of receipt.allocations) {
    const inv = await tx.invoice.findUnique({ where: { id: a.invoiceId } });
    if (inv) {
      await tx.invoice.update({
        where: { id: a.invoiceId },
        data: { amountSettledPaise: inv.amountSettledPaise - a.amountPaise },
      });
    }
    await tx.receiptAllocation.delete({ where: { id: a.id } });
  }

  const updated = await tx.receipt.update({
    where: { id: receipt.id },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Receipt",
    entityId: receipt.id,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: "POSTED" },
    after: {
      status: "CANCELLED",
      docNo: receipt.docNo,
      unwound: receipt.allocations.length,
    },
  });
  return updated;
}
