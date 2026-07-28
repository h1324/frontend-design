// lib/uom.ts — the ONLY place weight / area / density / GSM conversions exist.
//
// CLAUDE.md rule 1: never calculate these inline anywhere else — import this module.
// Pure functions over Decimal; no I/O, no clock, no framework imports (spec S1).
//
// A product is an ordered LAYER STACK. A plain sheet is a stack of one layer; a laminate
// is a stack of N layers, each with its own thickness and density. This makes laminates
// first-class rather than a special case bolted onto a single-sheet formula.
//
// Per-layer, then summed:
//   layer_weight_kg = length_m × width_m × (thickness_mm / 1000) × density_kg_m3
//   weight_kg       = Σ layer_weight_kg
//   area_m2         = length_m × width_m            (face area — ONE face, not per layer)
//   gsm             = Σ (thickness_mm × density_kg_m3)
//   composite_density = weight_kg / (area_m2 × total_thickness_mm/1000)
// For a single-layer input these reduce exactly to the brief §5 formulas.

import { Decimal, type DecimalInput } from './decimal.js';

/** Thrown for any invalid input. We never let a bad value become a silent NaN. */
export class UomError extends Error {
  override name = 'UomError';
}

export interface Layer {
  thickness_mm: DecimalInput;
  density_kg_m3: DecimalInput;
}

export interface Dimensions {
  length_m: DecimalInput;
  width_m: DecimalInput;
  /** At least one layer. */
  layers: Layer[];
}

const MM_PER_M = new Decimal(1000);
const HUNDRED = new Decimal(100);

// --- input coercion & validation -------------------------------------------------------

/** Coerce accepted input to Decimal. Rejects `number` (float-imprecision guard) and any
 *  non-finite value, so no invalid quantity can enter the maths. */
function toDecimal(value: DecimalInput, label: string): Decimal {
  if (typeof value === 'number') {
    throw new UomError(
      `${label}: pass a Decimal or string, not a JS number (float imprecision is not allowed for quantities)`,
    );
  }
  let d: Decimal;
  try {
    d = value instanceof Decimal ? value : new Decimal(value);
  } catch {
    throw new UomError(`${label}: not a valid decimal value ("${String(value)}")`);
  }
  if (!d.isFinite()) throw new UomError(`${label}: must be finite (got ${d.toString()})`);
  return d;
}

/** Coerce and require strictly positive. */
function positive(value: DecimalInput, label: string): Decimal {
  const d = toDecimal(value, label);
  if (d.lte(0)) throw new UomError(`${label}: must be greater than zero (got ${d.toString()})`);
  return d;
}

interface NormalisedLayer {
  thickness_mm: Decimal;
  density_kg_m3: Decimal;
}
interface Normalised {
  length_m: Decimal;
  width_m: Decimal;
  layers: NormalisedLayer[];
}

function normalise(dims: Dimensions): Normalised {
  if (!dims || !Array.isArray(dims.layers) || dims.layers.length === 0) {
    throw new UomError('dimensions.layers: at least one layer is required');
  }
  return {
    length_m: positive(dims.length_m, 'length_m'),
    width_m: positive(dims.width_m, 'width_m'),
    layers: dims.layers.map((l, i) => ({
      thickness_mm: positive(l.thickness_mm, `layers[${i}].thickness_mm`),
      density_kg_m3: positive(l.density_kg_m3, `layers[${i}].density_kg_m3`),
    })),
  };
}

// --- conversions -----------------------------------------------------------------------

/** Face area of one side of the product (length × width). Not multiplied by layer count. */
export function areaM2(dims: Dimensions): Decimal {
  const d = normalise(dims);
  return d.length_m.times(d.width_m);
}

/** Total layer area consumed to build the product = face area × layer count. For a
 *  laminate this exceeds {@link areaM2}; the difference is where converting loss lives. */
export function inputAreaM2(dims: Dimensions): Decimal {
  const d = normalise(dims);
  return d.length_m.times(d.width_m).times(d.layers.length);
}

/** Total weight in kg, summed across all layers. */
export function weightKg(dims: Dimensions): Decimal {
  const d = normalise(dims);
  const face = d.length_m.times(d.width_m);
  return d.layers.reduce(
    (sum, l) => sum.plus(face.times(l.thickness_mm.div(MM_PER_M)).times(l.density_kg_m3)),
    new Decimal(0),
  );
}

/** Sum of all layer thicknesses in mm. */
export function totalThicknessMm(dims: Dimensions): Decimal {
  const d = normalise(dims);
  return d.layers.reduce((sum, l) => sum.plus(l.thickness_mm), new Decimal(0));
}

/** Effective single density of the whole product = weight ÷ (face area × total thickness).
 *  For a single-layer product this returns that layer's density. */
export function compositeDensity(dims: Dimensions): Decimal {
  const d = normalise(dims);
  const face = d.length_m.times(d.width_m);
  const totalThicknessM = totalThicknessMm(dims).div(MM_PER_M);
  return weightKg(dims).div(face.times(totalThicknessM));
}

/** Grams per square metre (areal weight) = Σ(thickness_mm × density_kg_m3). */
export function gsm(dims: Dimensions): Decimal {
  const d = normalise(dims);
  return d.layers.reduce(
    (sum, l) => sum.plus(l.thickness_mm.times(l.density_kg_m3)),
    new Decimal(0),
  );
}

/** Solve for the roll length that yields a target weight, given a fixed cross-section
 *  (width + layer stack). Inverse of {@link weightKg}; used for production planning. */
export function lengthForWeightKg(
  targetKg: DecimalInput,
  width_m: DecimalInput,
  layers: Layer[],
): Decimal {
  const target = positive(targetKg, 'targetKg');
  const width = positive(width_m, 'width_m');
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new UomError('layers: at least one layer is required');
  }
  // weight per metre of length = width × Σ(thickness/1000 × density)
  const perMetre = layers.reduce((sum, l, i) => {
    const t = positive(l.thickness_mm, `layers[${i}].thickness_mm`);
    const rho = positive(l.density_kg_m3, `layers[${i}].density_kg_m3`);
    return sum.plus(width.times(t.div(MM_PER_M)).times(rho));
  }, new Decimal(0));
  return target.div(perMetre);
}

/** Signed variance of actual (weighed) against theoretical (calculated) weight, as a
 *  percentage: (actual − theoretical) / theoretical × 100. Zero when equal. A persistent
 *  non-zero value is a quality signal (the line running off its density spec). */
export function weightVariancePct(
  theoreticalKg: DecimalInput,
  actualKg: DecimalInput,
): Decimal {
  const theoretical = toDecimal(theoreticalKg, 'theoreticalKg');
  const actual = toDecimal(actualKg, 'actualKg');
  if (theoretical.lte(0)) {
    throw new UomError('theoreticalKg: must be greater than zero to compute a variance');
  }
  return actual.minus(theoretical).div(theoretical).times(HUNDRED);
}
