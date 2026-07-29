import type { Prisma } from "@prisma/client";

// Append-only audit trail (CLAUDE.md rules 6 & 8): who, what, when, previous value.
// Only an insert helper exists — there is deliberately no update or delete. A DB trigger
// (see the S2 migration) rejects UPDATE/DELETE on the table so the guarantee holds even
// against direct SQL. Corrections are new rows, never edits.

type Tx = Prisma.TransactionClient;

export interface AuditInput {
  companyId: string;
  /** Table/entity name, e.g. "Item". */
  entity: string;
  /** Primary key of the affected row. */
  entityId: string;
  /** What happened, e.g. "CREATE" | "UPDATE" | "CANCEL". */
  action: string;
  /** User responsible, if any (system actions may be null). */
  actorUserId?: string | null;
  /** Value before the change (omit for creations). */
  before?: Prisma.InputJsonValue;
  /** Value after the change (omit for deletions/cancellations). */
  after?: Prisma.InputJsonValue;
}

/**
 * Write one audit row. Call inside the same transaction as the movement it records so the
 * audit entry and the change commit together.
 */
export async function writeAudit(tx: Tx, input: AuditInput) {
  return tx.auditLog.create({
    data: {
      companyId: input.companyId,
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      ...(input.before !== undefined ? { beforeJson: input.before } : {}),
      ...(input.after !== undefined ? { afterJson: input.after } : {}),
    },
  });
}
