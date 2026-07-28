# Spec S1 — UOM Conversion Engine (`lib/uom.ts`)

**Status:** Built — `lib/uom.ts` + `tests/uom.test.ts` (31 tests). Toolchain: a minimal
TS + Vitest + decimal.js slice; full S0 scaffold (Next.js/Prisma/Auth) remains its own
session.

## Purpose

The single source of truth for every weight ↔ area ↔ density conversion in the system.
Everything downstream depends on it. Built first, tested hardest, never bypassed
(CLAUDE.md rule 1).

## Scope

**In:** pure functions over `Decimal`. Single-sheet and multi-layer (laminate)
conversions. GSM. Theoretical-vs-actual variance. No database, no I/O, no framework
imports.

**Out:** persistence, rounding for display (callers format), anything that touches
Prisma.

## Dependencies

- S0 (Decimal type + scale constants from `lib/decimal.ts`).

## Domain model

A product is an **ordered layer stack**. A plain foam sheet is a stack of one layer; a
laminate is a stack of N layers, each with its own thickness and density. This makes
laminates first-class instead of a special case bolted onto a single-sheet formula.

```ts
interface Layer {
  thickness_mm: Decimal;      // > 0
  density_kg_m3: Decimal;     // > 0, typically 15–45 for EPE
}

interface Dimensions {
  length_m: Decimal;          // > 0
  width_m: Decimal;           // > 0
  layers: Layer[];            // length >= 1
}
```

## Governing formulas

Per layer, then summed:

```
layer_weight_kg = length_m × width_m × (thickness_mm / 1000) × density_kg_m3
weight_kg       = Σ layer_weight_kg
area_m2         = length_m × width_m          // face area — ONE face, not per layer
total_thickness_mm = Σ thickness_mm
composite_density_kg_m3 = weight_kg / (area_m2 × (total_thickness_mm / 1000))
gsm             = Σ (thickness_mm × density_kg_m3)   // = weight per m², in g/m²
```

For a single-layer input these reduce exactly to the brief's §5 formulas.

## Public API (proposed signatures)

```ts
export function weightKg(dims: Dimensions): Decimal;
export function areaM2(dims: Dimensions): Decimal;              // face area
export function inputAreaM2(dims: Dimensions): Decimal;         // Σ per-layer area, for yield calcs
export function compositeDensity(dims: Dimensions): Decimal;
export function gsm(dims: Dimensions): Decimal;

// Given a target weight and fixed cross-section, solve for length (production planning):
export function lengthForWeightKg(
  targetKg: Decimal, width_m: Decimal, layers: Layer[],
): Decimal;

// Quality KPI: how far actual (weighed) deviates from theoretical (calculated).
export function weightVariancePct(theoreticalKg: Decimal, actualKg: Decimal): Decimal;
```

Callers store BOTH the derived `qty_kg` (theoretical) and `qty_m2`, plus the raw
dimensional attributes, so any row can be re-derived and audited.

## Rules & invariants

1. **`Decimal` only.** Inputs, intermediates, outputs. No `number` arithmetic.
2. **Reject invalid input** with typed errors, never silent `NaN`: non-positive
   dimensions, empty layer stack, non-finite values.
3. **Rounding is explicit and centralised.** Define one internal rounding policy
   (**default: `ROUND_HALF_UP`**) and fixed working scale (**default: 6 dp** internally;
   callers round for storage/display). Document it at the top of the file.
4. **Round-trip stability:** `lengthForWeightKg` then `weightKg` must return to the
   original weight within the documented tolerance.
5. Pure — same inputs always give same outputs, no clock, no randomness, no I/O.

## Acceptance criteria — the test suite is the deliverable

Ship `tests/uom.test.ts` covering, at minimum:

- **Round-trip:** weight → length → weight for single and multi-layer, within tolerance.
- **Single-layer sanity:** hand-computed example (e.g. 100 m × 2 m × 5 mm × 25 kg/m³)
  matches to the documented scale.
- **Laminate:** 8-layer stack of mixed thickness/density; verify `weight_kg`,
  `composite_density`, and that `area_m2` is one face (not 8×).
- **Boundary values:** 0.5 mm ultra-thin; very wide roll; very low/high density.
- **Yield helper:** `inputAreaM2` > `areaM2` for laminates (conversion loss is visible).
- **Variance:** theoretical vs actual returns correct signed percentage; 0 when equal.
- **Junk input:** zero/negative dimensions, empty layers, non-finite → typed error, no
  `NaN` leaks.
- **GSM:** equals `weight_kg / area_m2 × 1000` for the single-layer case.

`npm run check` green with the suite passing.

## Open questions

- ⚠️ **Density typical range** for validation bounds — CLAUDE.md says 15–45 kg/m³. Treat
  as a soft warning range or a hard reject? **Default: soft** (warn, don't block — odd
  specials exist).
- Internal working scale and rounding mode (defaults above). Confirm if finance needs a
  specific rounding convention for invoice weights.
- Whether `lengthForWeightKg` is needed in Phase 0 or deferrable to production (S-Phase
  1). **Default: include it now, it's cheap and pure.**
