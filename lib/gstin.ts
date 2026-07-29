// lib/gstin.ts — Indian GSTIN format validation, shared by supplier (S6) and customer (S7).
// Format only (no checksum) for Phase 0; full checksum can come with e-invoicing (Phase 3).
//
// Structure: SS PPPPPPPPPP E Z C  (15 chars)
//   SS  2-digit state code
//   PPPPPPPPPP  PAN: 5 letters, 4 digits, 1 letter
//   E   entity number (1–9 or A–Z)
//   Z   literal 'Z'
//   C   checksum (alphanumeric)

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** True if the string matches the 15-char GSTIN format (case-sensitive, uppercase). */
export function isValidGstinFormat(gstin: string): boolean {
  return GSTIN_RE.test(gstin);
}

/** The 2-digit state code embedded in a GSTIN, or null if the format is invalid. */
export function gstinStateCode(gstin: string): string | null {
  return isValidGstinFormat(gstin) ? gstin.slice(0, 2) : null;
}
