import { describe, it, expect } from 'vitest';
import {
  periodLabel, periodKeyFromLabel, financialYearOf, financialYearMonths,
  shiftPeriod, trailingPeriods,
} from '../period';

describe('period keys ↔ labels', () => {
  it('formats and parses', () => {
    expect(periodLabel('2026-04')).toBe('April 2026');
    expect(periodKeyFromLabel('April 2026')).toBe('2026-04');
    expect(periodKeyFromLabel('Production_update_APRIL__2026')).toBe('2026-04');
    expect(periodKeyFromLabel('nope')).toBeNull();
  });
});

describe('Indian financial year (Apr–Mar)', () => {
  it('April 2026 and March 2027 are the same FY 2026-27', () => {
    expect(financialYearOf('2026-04').label).toBe('2026-27');
    expect(financialYearOf('2027-03').label).toBe('2026-27');
    expect(financialYearOf('2027-04').label).toBe('2027-28'); // next FY
  });
  it('lists the 12 months of the FY, Apr → Mar', () => {
    const months = financialYearMonths('2026-07');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-04');
    expect(months[11]).toBe('2027-03');
  });
});

describe('shift / trailing', () => {
  it('shiftPeriod crosses year boundaries', () => {
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
  });
  it('trailingPeriods returns oldest → newest, inclusive', () => {
    expect(trailingPeriods('2026-04', 3)).toEqual(['2026-02', '2026-03', '2026-04']);
  });
});
