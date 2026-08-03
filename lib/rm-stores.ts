// lib/rm-stores.ts — raw-material receipt & issue (spec S9).
// Lightweight stores for commissioning: receipts post BULK IN, issues post BULK OUT
// (negative-blocked by S3). Documents are cancelled, never deleted — cancellation posts
// reversing entries. Every posting and document change writes an audit row. STORES-write
// gated. Full PO/GRN/QC/landed-cost valuation is Phase 2/3.

import type { MaterialIssue, MaterialReceipt, Prisma } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { nextDocNumber } from "./doc-number.js";
import { post, reverse } from "./stock-ledger.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

export class StoresValidationError extends Error {
  override name = "StoresValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

export interface ReceiptLineInput {
  itemId: string;
  locationId: string;
  qtyBase: DecimalInput;
  /** Optional landed rate in paise (valuation is Phase 3). */
  ratePaise?: number | null;
}
export interface ReceiptInput {
  supplierId?: string | null;
  refNote?: string | null;
  receivedAt?: Date;
  lines: ReceiptLineInput[];
}

export interface IssueLineInput {
  itemId: string;
  locationId: string;
  qtyBase: DecimalInput;
  isRegrind?: boolean;
}
export interface IssueInput {
  /** The production lot consuming the material (S10 adds the Lot model). */
  lotId?: string | null;
  refNote?: string | null;
  issuedAt?: Date;
  lines: IssueLineInput[];
}

function validateLines(
  lines: { itemId: string; locationId: string; qtyBase: DecimalInput }[],
): string[] {
  const errors: string[] = [];
  if (!lines?.length) errors.push("at least one line is required");
  lines?.forEach((l, i) => {
    if (!l.itemId) errors.push(`line ${i + 1}: item is required`);
    if (!l.locationId) errors.push(`line ${i + 1}: location is required`);
    try {
      if (new Decimal(l.qtyBase).lte(0))
        errors.push(`line ${i + 1}: quantity must be > 0`);
    } catch {
      errors.push(`line ${i + 1}: quantity is not a number`);
    }
  });
  return errors;
}

// --- receipt -------------------------------------------------------------------------

export async function createReceipt(
  tx: Tx,
  actor: Actor,
  input: ReceiptInput,
): Promise<MaterialReceipt> {
  requireAccess(actor, "STORES", "write");
  const errors = validateLines(input.lines);
  if (errors.length) throw new StoresValidationError(errors);

  const docNo = await nextDocNumber(tx, actor.companyId, "MATERIAL_RECEIPT", {
    prefix: "RCPT",
    ...(input.receivedAt ? { now: input.receivedAt } : {}),
  });
  const receipt = await tx.materialReceipt.create({
    data: {
      companyId: actor.companyId,
      docNo,
      supplierId: input.supplierId ?? null,
      refNote: input.refNote ?? null,
      createdById: actor.userId,
      ...(input.receivedAt ? { receivedAt: input.receivedAt } : {}),
    },
  });

  for (const line of input.lines) {
    const created = await tx.materialReceiptLine.create({
      data: {
        receiptId: receipt.id,
        itemId: line.itemId,
        locationId: line.locationId,
        qtyBase: String(line.qtyBase),
        ratePaise: line.ratePaise ?? null,
      },
    });
    const posting = await post(tx, {
      grain: "BULK",
      direction: "IN",
      companyId: actor.companyId,
      itemId: line.itemId,
      locationId: line.locationId,
      qtyBase: line.qtyBase,
      reason: "GRN",
      refType: "MaterialReceipt",
      refId: receipt.id,
      actorUserId: actor.userId,
    });
    await tx.materialReceiptLine.update({
      where: { id: created.id },
      data: { ledgerId: posting.id },
    });
  }

  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "MaterialReceipt",
    entityId: receipt.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: { docNo: receipt.docNo, lines: input.lines.length },
  });
  return receipt;
}

export async function cancelReceipt(
  tx: Tx,
  actor: Actor,
  receiptId: string,
): Promise<MaterialReceipt> {
  requireAccess(actor, "STORES", "write");
  const receipt = await tx.materialReceipt.findFirst({
    where: { id: receiptId, companyId: actor.companyId },
    include: { lines: true },
  });
  if (!receipt) throw new AuthzError("receipt not found");
  if (receipt.status === "CANCELLED") {
    throw new StoresValidationError(["receipt is already cancelled"]);
  }

  // Reverse each line's IN. A reversal that would drive the balance negative (material
  // already consumed) is refused by S3 — you cannot cancel a receipt whose stock is gone.
  for (const line of receipt.lines) {
    if (line.ledgerId) {
      await reverse(
        tx,
        line.ledgerId,
        actor.userId,
        `receipt ${receipt.docNo} cancelled`,
      );
    }
  }

  const updated = await tx.materialReceipt.update({
    where: { id: receiptId },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "MaterialReceipt",
    entityId: receiptId,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: "POSTED" },
    after: { status: "CANCELLED", docNo: receipt.docNo },
  });
  return updated;
}

// --- issue ---------------------------------------------------------------------------

export async function createIssue(
  tx: Tx,
  actor: Actor,
  input: IssueInput,
): Promise<MaterialIssue> {
  requireAccess(actor, "STORES", "write");
  const errors = validateLines(input.lines);
  if (errors.length) throw new StoresValidationError(errors);

  const docNo = await nextDocNumber(tx, actor.companyId, "MATERIAL_ISSUE", {
    prefix: "ISS",
    ...(input.issuedAt ? { now: input.issuedAt } : {}),
  });
  const issue = await tx.materialIssue.create({
    data: {
      companyId: actor.companyId,
      docNo,
      lotId: input.lotId ?? null,
      refNote: input.refNote ?? null,
      createdById: actor.userId,
      ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
    },
  });

  for (const line of input.lines) {
    const created = await tx.materialIssueLine.create({
      data: {
        issueId: issue.id,
        itemId: line.itemId,
        locationId: line.locationId,
        qtyBase: String(line.qtyBase),
        isRegrind: line.isRegrind ?? false,
      },
    });
    // BULK OUT — negative-blocked by S3; throws StockError if insufficient stock.
    const posting = await post(tx, {
      grain: "BULK",
      direction: "OUT",
      companyId: actor.companyId,
      itemId: line.itemId,
      locationId: line.locationId,
      qtyBase: line.qtyBase,
      reason: "PRODUCTION",
      refType: "MaterialIssue",
      refId: issue.id,
      actorUserId: actor.userId,
    });
    await tx.materialIssueLine.update({
      where: { id: created.id },
      data: { ledgerId: posting.id },
    });
  }

  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "MaterialIssue",
    entityId: issue.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: { docNo: issue.docNo, lotId: issue.lotId, lines: input.lines.length },
  });
  return issue;
}

export async function cancelIssue(
  tx: Tx,
  actor: Actor,
  issueId: string,
): Promise<MaterialIssue> {
  requireAccess(actor, "STORES", "write");
  const issue = await tx.materialIssue.findFirst({
    where: { id: issueId, companyId: actor.companyId },
    include: { lines: true },
  });
  if (!issue) throw new AuthzError("issue not found");
  if (issue.status === "CANCELLED") {
    throw new StoresValidationError(["issue is already cancelled"]);
  }

  // Reverse each line's OUT — adds the material back to stock.
  for (const line of issue.lines) {
    if (line.ledgerId) {
      await reverse(tx, line.ledgerId, actor.userId, `issue ${issue.docNo} cancelled`);
    }
  }

  const updated = await tx.materialIssue.update({
    where: { id: issueId },
    data: { status: "CANCELLED" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "MaterialIssue",
    entityId: issueId,
    action: "CANCEL",
    actorUserId: actor.userId,
    before: { status: "POSTED" },
    after: { status: "CANCELLED", docNo: issue.docNo },
  });
  return updated;
}
