// lib/customer-tier.ts — customer tier scoring (spec S18). Deterministic and pure: the tier
// is a function of the customer's trading history alone, so it is unit-testable without a DB.
// The tier service (lib/sales-order.ts `recomputeTier`) gathers the inputs and persists the
// result. Defaults per S18 open question — refine the weights/bands once the real formula is
// agreed; the shape stays the same.

import type { CustomerTier } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";

/** Trading signals that drive the tier. Sourced from dispatch/invoice history and (later) S19
 *  payment behaviour. Kept explicit so the scorer stays pure. */
export interface TierInputs {
  /** Rolling 12-month dispatched volume, in kg. */
  rolling12mVolumeKg: DecimalInput;
  /** On-time payment ratio 0..1 from S19 ageing; null when payment history is unknown
   *  (payments live in Tally) — treated as neutral. */
  onTimePaymentRatio: number | null;
  /** Months of trading history; too little → UNGRADED. */
  monthsOfHistory: number;
}

/** Tunable scoring configuration (defaults per S18). Volume is normalised against a
 *  full-score threshold; volume and payment are combined with equal weight; the composite is
 *  banded into A/B/C. */
export interface TierConfig {
  /** Minimum months of history before a customer is graded at all. */
  minMonths: number;
  /** Rolling-12m volume (kg) that earns the full volume sub-score of 1.0. */
  volumeFullScoreKg: DecimalInput;
  /** Neutral payment sub-score used when `onTimePaymentRatio` is null. */
  neutralPaymentScore: number;
  /** Composite ≥ `a` → A; ≥ `b` → B; else C. */
  bandA: number;
  bandB: number;
}

export const DEFAULT_TIER_CONFIG: TierConfig = {
  minMonths: 3,
  volumeFullScoreKg: "50000",
  neutralPaymentScore: 0.5,
  bandA: 0.66,
  bandB: 0.33,
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** The composite 0..1 score: equal-weight blend of normalised volume and payment behaviour.
 *  Pure — the same inputs always give the same score. */
export function tierScore(
  inputs: TierInputs,
  config: TierConfig = DEFAULT_TIER_CONFIG,
): number {
  const volume = new Decimal(inputs.rolling12mVolumeKg);
  const full = new Decimal(config.volumeFullScoreKg);
  const volumeScore = full.lte(0) ? 0 : clamp01(Number(volume.div(full).toString()));
  const paymentScore =
    inputs.onTimePaymentRatio == null
      ? config.neutralPaymentScore
      : clamp01(inputs.onTimePaymentRatio);
  return 0.5 * volumeScore + 0.5 * paymentScore;
}

/** Score a customer into a tier. Below `minMonths` of history → UNGRADED regardless of score.
 *  Pure and deterministic (spec S18 acceptance #3). */
export function scoreTier(
  inputs: TierInputs,
  config: TierConfig = DEFAULT_TIER_CONFIG,
): CustomerTier {
  if (inputs.monthsOfHistory < config.minMonths) return "UNGRADED";
  const score = tierScore(inputs, config);
  if (score >= config.bandA) return "A";
  if (score >= config.bandB) return "B";
  return "C";
}
