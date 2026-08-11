// lib/receivables.ts — outstanding receivables (spec S18 dependency; ageing math is S19).
// This system is not the statutory book of record — payments are collected and reconciled in
// Tally (CLAUDE.md). From this system's view every issued, un-cancelled invoice is an open
// receivable; the credit check (S18) consumes that figure. S19 layers ageing buckets on top.

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Total open receivable for a customer, in paise: the sum of every ISSUED (non-cancelled,
 *  non-draft) invoice's grand total. A conservative default until S19 nets off settlements. */
export async function customerOutstandingPaise(
  db: Tx,
  companyId: string,
  customerId: string,
): Promise<bigint> {
  const agg = await db.invoice.aggregate({
    where: { companyId, customerId, status: "ISSUED" },
    _sum: { totalPaise: true },
  });
  return agg._sum.totalPaise ?? 0n;
}
