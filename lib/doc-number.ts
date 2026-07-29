import type { Prisma } from "@prisma/client";
import { financialYear } from "./financial-year.js";

// Financial-year-wise, gapless document numbers (CLAUDE.md rule 7).
//
// Allocation is an atomic ORM increment (`{ increment: 1 }` → SET nextSeq = nextSeq + 1),
// which takes a row lock for the duration of the caller's transaction. Two concurrent
// allocations therefore serialize on the row and can never receive the same number; and
// because the increment lives inside the caller's transaction, a rolled-back document
// rolls its number back too — preserving gaplessness in a way a bare Postgres sequence
// cannot. No ORM-bypassing raw SQL is used for the write (CLAUDE.md stack rule).

/** A Prisma transaction client — `nextDocNumber` MUST run inside `prisma.$transaction`
 *  together with the document insert, so the number and the document commit atomically. */
type Tx = Prisma.TransactionClient;

export interface NextDocNumberOptions {
  /** Instant used to pick the financial year. Defaults to now. */
  now?: Date;
  /** Human prefix for the formatted number. Defaults to the docType. */
  prefix?: string;
}

/** `PREFIX/FY/000123` — zero-padded to 6 digits. */
export function formatDocNumber(prefix: string, fy: string, seq: number): string {
  return `${prefix}/${fy}/${String(seq).padStart(6, "0")}`;
}

/**
 * Allocate the next gapless number for a document type in the current financial year.
 * Returns the formatted string (e.g. `INV/2026-27/000001`).
 */
export async function nextDocNumber(
  tx: Tx,
  companyId: string,
  docType: string,
  options: NextDocNumberOptions = {},
): Promise<string> {
  const fy = financialYear(options.now ?? new Date());
  const prefix = options.prefix ?? docType;
  const where = {
    companyId_docType_financialYear: { companyId, docType, financialYear: fy },
  } satisfies Prisma.DocSeriesWhereUniqueInput;

  // Ensure the counter row exists for this (company, docType, FY). The unique constraint
  // makes concurrent first-time creation safe — one wins, and both then increment below.
  await tx.docSeries.upsert({
    where,
    create: { companyId, docType, financialYear: fy, prefix, nextSeq: 1 },
    update: {},
  });

  // Atomic increment under a row lock; the pre-increment value is the allocated number.
  const updated = await tx.docSeries.update({
    where,
    data: { nextSeq: { increment: 1 } },
  });

  return formatDocNumber(prefix, fy, updated.nextSeq - 1);
}
