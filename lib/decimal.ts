// Central Decimal configuration and scale constants.
//
// CLAUDE.md rule 2: never `float`/`number` for weights, dimensions, or money — every
// such value flows through Decimal. This module is the single place Decimal is
// configured and the single source of the storage scales, so no other file re-decides
// precision or rounding. (Spec S2 owns the full scale set; S1 uses a subset.)

import Decimal from 'decimal.js';

// Generous internal precision so multi-step maths (round-trips, laminate sums) never
// loses significance; rounding is half-up (spec S1 §Rules 3). Callers round to the
// storage SCALE below when persisting.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** Storage scales (decimal places) per quantity kind. Persist at these; compute above them. */
export const SCALE = {
  KG: 3, // weight, kilograms
  MM: 2, // linear dimension, millimetres
  M: 3, // linear dimension, metres
  M2: 4, // area, square metres
  DENSITY: 3, // kg/m³
  GSM: 2, // grams/m²
  MONEY: 2, // rupees (paise precision)
  WORKING: 6, // minimum meaningful scale for intermediate/display values
} as const;

/** Accepted numeric input at module boundaries. `number` is deliberately excluded to
 *  keep float imprecision out of the ledger (enforced at runtime by {@link toDecimal}). */
export type DecimalInput = Decimal | string;
