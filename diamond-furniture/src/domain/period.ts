/**
 * Period + Indian financial-year helpers.
 * A period key is 'YYYY-MM' (e.g. '2026-04'). The financial year runs Apr–Mar.
 */
export type PeriodKey = string;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_INDEX: Record<string, number> = Object.fromEntries(
  MONTHS.map((m, i) => [m.toLowerCase(), i + 1]),
);

/** '2026-04' → { year: 2026, month: 4 } */
export function parsePeriodKey(key: PeriodKey): { year: number; month: number } {
  const [y, m] = key.split('-');
  return { year: Number(y), month: Number(m) };
}

/** '2026-04' → 'April 2026' */
export function periodLabel(key: PeriodKey): string {
  const { year, month } = parsePeriodKey(key);
  return `${MONTHS[month - 1] ?? '?'} ${year}`;
}

/** Parse a free-form label like 'April 2026' or 'APRIL_2026' → '2026-04' (or null). */
export function periodKeyFromLabel(label: string): PeriodKey | null {
  const m = /([A-Za-z]+)[\s_-]*(\d{4})/.exec(label);
  if (!m) return null;
  const month = MONTH_INDEX[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[2]}-${String(month).padStart(2, '0')}`;
}

/** The financial year a period belongs to (Apr–Mar). '2026-05' → FY 2026-27. */
export function financialYearOf(key: PeriodKey): { startYear: number; label: string } {
  const { year, month } = parsePeriodKey(key);
  const startYear = month >= 4 ? year : year - 1;
  return { startYear, label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}` };
}

/** The 12 period keys of the financial year containing `key`, Apr→Mar. */
export function financialYearMonths(key: PeriodKey): PeriodKey[] {
  const { startYear } = financialYearOf(key);
  const keys: PeriodKey[] = [];
  for (let i = 0; i < 12; i++) {
    const month = ((3 + i) % 12) + 1; // 4,5,...,12,1,2,3
    const year = month >= 4 ? startYear : startYear + 1;
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return keys;
}

/** Shift a period key by `delta` months (negative = earlier). */
export function shiftPeriod(key: PeriodKey, delta: number): PeriodKey {
  const { year, month } = parsePeriodKey(key);
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** The last `n` period keys ending at (and including) `key`, oldest → newest. */
export function trailingPeriods(key: PeriodKey, n: number): PeriodKey[] {
  const out: PeriodKey[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftPeriod(key, -i));
  return out;
}

/** Sort comparator for period keys (chronological). */
export function comparePeriodKeys(a: PeriodKey, b: PeriodKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
