import { describe, it, expect } from 'vitest';
import { Decimal } from '../lib/decimal.js';
import {
  areaM2,
  inputAreaM2,
  weightKg,
  totalThicknessMm,
  compositeDensity,
  gsm,
  lengthForWeightKg,
  weightVariancePct,
  UomError,
  type Dimensions,
} from '../lib/uom.js';

/** Assert two Decimals are equal within a tolerance (round-trip / float-free checks). */
function expectClose(actual: Decimal, expected: Decimal | string, tol = '1e-9') {
  const exp = new Decimal(expected);
  const diff = actual.minus(exp).abs();
  expect(
    diff.lte(new Decimal(tol)),
    `expected ${actual.toString()} ≈ ${exp.toString()} (|Δ|=${diff.toString()})`,
  ).toBe(true);
}

describe('single-layer sanity', () => {
  // 100 m × 2 m × 5 mm × 25 kg/m³
  const dims: Dimensions = {
    length_m: '100',
    width_m: '2',
    layers: [{ thickness_mm: '5', density_kg_m3: '25' }],
  };

  it('weight = 25 kg', () => expectClose(weightKg(dims), '25'));
  it('area = 200 m² (one face)', () => expectClose(areaM2(dims), '200'));
  it('input area equals face area for a single layer', () =>
    expectClose(inputAreaM2(dims), '200'));
  it('gsm = 125 g/m² and equals weight/area×1000', () => {
    expectClose(gsm(dims), '125');
    expectClose(weightKg(dims).div(areaM2(dims)).times(1000), '125');
  });
  it('composite density returns the single layer density', () =>
    expectClose(compositeDensity(dims), '25'));
});

describe('laminate (uniform density)', () => {
  // 8 layers × 2 mm × 30 kg/m³, 50 m × 1.5 m
  const dims: Dimensions = {
    length_m: '50',
    width_m: '1.5',
    layers: Array.from({ length: 8 }, () => ({ thickness_mm: '2', density_kg_m3: '30' })),
  };

  it('weight sums across all 8 layers = 36 kg', () => expectClose(weightKg(dims), '36'));
  it('area is ONE face (75 m²), not 8×', () => expectClose(areaM2(dims), '75'));
  it('input area is 8× the face (600 m²) — converting loss is visible', () => {
    expectClose(inputAreaM2(dims), '600');
    expect(inputAreaM2(dims).gt(areaM2(dims))).toBe(true);
  });
  it('total thickness = 16 mm', () => expectClose(totalThicknessMm(dims), '16'));
  it('composite density = 30 (uniform)', () => expectClose(compositeDensity(dims), '30'));
  it('gsm = 480 and equals weight/area×1000', () => {
    expectClose(gsm(dims), '480');
    expectClose(weightKg(dims).div(areaM2(dims)).times(1000), '480');
  });
});

describe('laminate (mixed density) — composite density is a real blend', () => {
  // [1 mm @ 20] + [3 mm @ 40], 10 m × 1 m
  const dims: Dimensions = {
    length_m: '10',
    width_m: '1',
    layers: [
      { thickness_mm: '1', density_kg_m3: '20' },
      { thickness_mm: '3', density_kg_m3: '40' },
    ],
  };

  it('weight = 1.4 kg', () => expectClose(weightKg(dims), '1.4'));
  it('composite density = 35, i.e. neither layer density', () => {
    const cd = compositeDensity(dims);
    expectClose(cd, '35');
    expect(cd.equals(20)).toBe(false);
    expect(cd.equals(40)).toBe(false);
  });
  it('gsm = 140 and equals weight/area×1000', () => {
    expectClose(gsm(dims), '140');
    expectClose(weightKg(dims).div(areaM2(dims)).times(1000), '140');
  });
});

describe('round-trip stability: weight → length → weight', () => {
  it('single layer returns to the original weight', () => {
    const layers = [{ thickness_mm: '5', density_kg_m3: '25' }];
    const length = lengthForWeightKg('25', '2', layers);
    expectClose(length, '100');
    const back = weightKg({ length_m: length, width_m: '2', layers });
    expectClose(back, '25');
  });

  it('mixed-density laminate returns to the original weight', () => {
    const layers = [
      { thickness_mm: '0.5', density_kg_m3: '18' },
      { thickness_mm: '4', density_kg_m3: '33' },
      { thickness_mm: '2.25', density_kg_m3: '41' },
    ];
    const target = '73.456';
    const length = lengthForWeightKg(target, '1.37', layers);
    const back = weightKg({ length_m: length, width_m: '1.37', layers });
    expectClose(back, target);
  });
});

describe('boundary values', () => {
  it('0.5 mm ultra-thin computes a sane weight', () => {
    const dims: Dimensions = {
      length_m: '200',
      width_m: '1.2',
      layers: [{ thickness_mm: '0.5', density_kg_m3: '20' }],
    };
    expectClose(weightKg(dims), '2.4');
    expect(weightKg(dims).gt(0)).toBe(true);
  });

  it('very wide, low-density roll', () => {
    const dims: Dimensions = {
      length_m: '10',
      width_m: '3.2',
      layers: [{ thickness_mm: '40', density_kg_m3: '15' }],
    };
    // 10 × 3.2 × 0.04 × 15 = 19.2 kg
    expectClose(weightKg(dims), '19.2');
  });

  it('high density stays exact (no float drift)', () => {
    const dims: Dimensions = {
      length_m: '1',
      width_m: '1',
      layers: [{ thickness_mm: '10', density_kg_m3: '45' }],
    };
    // 1 × 1 × 0.01 × 45 = 0.45
    expect(weightKg(dims).toString()).toBe('0.45');
  });
});

describe('theoretical vs actual variance', () => {
  it('actual above theoretical → positive %', () =>
    expectClose(weightVariancePct('25', '25.5'), '2'));
  it('actual below theoretical → negative %', () =>
    expectClose(weightVariancePct('25', '24'), '-4'));
  it('equal → exactly zero', () =>
    expect(weightVariancePct('25', '25').isZero()).toBe(true));
  it('zero theoretical throws', () =>
    expect(() => weightVariancePct('0', '5')).toThrow(UomError));
});

describe('invalid input → typed error, never NaN', () => {
  const base = { width_m: '2', layers: [{ thickness_mm: '5', density_kg_m3: '25' }] };

  it('zero length', () =>
    expect(() => weightKg({ ...base, length_m: '0' })).toThrow(UomError));
  it('negative width', () =>
    expect(() => weightKg({ ...base, length_m: '10', width_m: '-1' })).toThrow(UomError));
  it('empty layer stack', () =>
    expect(() => weightKg({ length_m: '10', width_m: '2', layers: [] })).toThrow(UomError));
  it('non-positive thickness', () =>
    expect(() =>
      weightKg({ length_m: '10', width_m: '2', layers: [{ thickness_mm: '0', density_kg_m3: '25' }] }),
    ).toThrow(UomError));
  it('non-finite (NaN string)', () =>
    expect(() => weightKg({ ...base, length_m: 'NaN' })).toThrow(UomError));
  it('non-finite (Infinity)', () =>
    expect(() => weightKg({ ...base, length_m: 'Infinity' })).toThrow(UomError));
  it('rejects a raw JS number (float-imprecision guard)', () =>
    // @ts-expect-error — number is intentionally not assignable to DecimalInput
    expect(() => weightKg({ ...base, length_m: 10 })).toThrow(UomError));
  it('garbage string', () =>
    expect(() => weightKg({ ...base, length_m: 'ten' })).toThrow(UomError));
});
