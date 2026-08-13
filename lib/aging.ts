// lib/aging.ts — the aging queue (spec S12).
// Fresh foam is created CURING with an aging-ready date (S11). This module flips a roll to
// AVAILABLE once that date passes, so "available stock" ≠ "physical stock" is enforced
// automatically (CLAUDE.md rule 5). The sweep is idempotent and posts NO ledger entry — the
// roll doesn't move, only its sellability flips — but every transition writes an audit row.
// Early release before the ready date is a logged supervisor override.

import type { Prisma, Roll } from "@prisma/client";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MS_PER_DAY = 86_400_000;

export class AgingValidationError extends Error {
  override name = "AgingValidationError";
}

// --- countdown (pure) ----------------------------------------------------------------

export interface AgingCountdown {
  /** True once the ready date has passed (roll is due to be swept to AVAILABLE). */
  ready: boolean;
  /** Whole IST days until ready; 0 when ready today, negative once overdue. */
  daysRemaining: number;
  label: string;
}

/** IST calendar day number for an instant (days since epoch, IST). Pure. */
function istDayNumber(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / MS_PER_DAY);
}

/** How long until a curing roll is sellable, in whole IST days. "Ready today" = ready by end
 *  of the IST day (CLAUDE.md/S2 IST convention). Pure. */
export function agingCountdown(readyDate: Date | null, asOf: Date): AgingCountdown {
  if (!readyDate) {
    return { ready: true, daysRemaining: 0, label: "ready (no aging)" };
  }
  const days = istDayNumber(readyDate) - istDayNumber(asOf);
  const ready = readyDate.getTime() <= asOf.getTime();
  if (ready) return { ready: true, daysRemaining: days, label: "ready" };
  if (days <= 0) return { ready: false, daysRemaining: 0, label: "ready today" };
  if (days === 1) return { ready: false, daysRemaining: 1, label: "ready tomorrow" };
  return { ready: false, daysRemaining: days, label: `ready in ${days} days` };
}

// --- sweep ---------------------------------------------------------------------------

export interface SweepResult {
  flipped: number;
  rollIds: string[];
}

/**
 * Flip every roll whose aging is complete (CURING and `agingReadyDate <= asOf`) to AVAILABLE,
 * writing a `CURE_COMPLETE` audit row per transition. Idempotent: a second run finds nothing
 * due and changes nothing. No stock ledger posting — sellability flips, the roll stays put.
 *
 * `actorUserId` is optional: the scheduled job runs with no user (null), the on-demand UI
 * trigger passes the supervisor.
 */
export async function agingSweep(
  tx: Tx,
  companyId: string,
  asOf: Date = new Date(),
  actorUserId: string | null = null,
): Promise<SweepResult> {
  // Aging is one gate; QC pass (S16) is the other, independent, gate. A roll only becomes
  // AVAILABLE once BOTH are satisfied — so the sweep flips only aged rolls that are also
  // QC-passed. An aged-but-QC-pending roll stays CURING until QC passes it (which then flips
  // it, S16). QC-failed/rejected rolls never appear here.
  const due = await tx.roll.findMany({
    where: {
      companyId,
      state: "CURING",
      qcStatus: "PASSED",
      agingReadyDate: { not: null, lte: asOf },
    },
    select: { id: true, agingReadyDate: true },
  });
  if (due.length === 0) return { flipped: 0, rollIds: [] };

  const ids = due.map((r) => r.id);
  // Guarded on state=CURING so a concurrent flip is never double-counted; the enclosing
  // transaction's row locks keep this atomic against another sweep.
  await tx.roll.updateMany({
    where: { id: { in: ids }, state: "CURING" },
    data: { state: "AVAILABLE" },
  });

  for (const r of due) {
    await writeAudit(tx, {
      companyId,
      entity: "Roll",
      entityId: r.id,
      action: "CURE_COMPLETE",
      actorUserId,
      before: { state: "CURING" },
      after: { state: "AVAILABLE", agingReadyDate: r.agingReadyDate },
    });
  }
  return { flipped: due.length, rollIds: ids };
}

// --- early release (logged override) -------------------------------------------------

/**
 * Release a still-curing roll to AVAILABLE before its ready date — a supervisor override
 * (CLAUDE.md rule 5), recorded with user + reason. Refused without a reason, and only from
 * CURING (an already-available/dispatched roll is not "released"). PRODUCTION-write gated.
 */
export async function releaseEarly(
  tx: Tx,
  actor: Actor,
  rollId: string,
  reason: string,
): Promise<Roll> {
  requireAccess(actor, "PRODUCTION", "write");
  if (!reason?.trim()) {
    throw new AgingValidationError("a reason is required to release a curing roll early");
  }
  const roll = await tx.roll.findFirst({
    where: { id: rollId, companyId: actor.companyId },
  });
  if (!roll) throw new AuthzError("roll not found");
  if (roll.state !== "CURING") {
    throw new AgingValidationError(`roll ${roll.rollNo} is ${roll.state}, not CURING`);
  }

  const updated = await tx.roll.update({
    where: { id: roll.id },
    data: { state: "AVAILABLE" },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Roll",
    entityId: roll.id,
    action: "RELEASE_EARLY",
    actorUserId: actor.userId,
    before: { state: "CURING", agingReadyDate: roll.agingReadyDate },
    after: { state: "AVAILABLE", overrideReason: reason.trim() },
  });
  return updated;
}
