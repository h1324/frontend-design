// lib/gst.ts — pure GST computation for the tax invoice (spec S13).
// Money is in paise (integers); rates and quantities are Decimal. This module only computes
// the numbers on the document — it is NOT an accounting ledger (statutory books stay in
// Tally, CLAUDE.md). Tax is CGST+SGST intra-state, IGST inter-state, by ship-to state.

import { Decimal, type DecimalInput } from "./decimal.js";

const HALF_UP = Decimal.ROUND_HALF_UP;

/** Intra-state when seller and buyer (ship-to) are in the same GST state → CGST + SGST;
 *  otherwise inter-state → IGST. Codes are the 2-digit GST state codes. Pure. */
export function isIntraState(sellerStateCode: string, buyerStateCode: string): boolean {
  const a = (sellerStateCode ?? "").trim();
  const b = (buyerStateCode ?? "").trim();
  return a !== "" && a === b;
}

/** Taxable value in paise for a line: billed quantity × rate-per-unit (paise), rounded to the
 *  nearest paisa. Pure. */
export function lineTaxableValuePaise(
  qty: DecimalInput,
  ratePaise: number | bigint,
): number {
  const value = new Decimal(qty).times(new Decimal(ratePaise.toString()));
  return Number(value.toDecimalPlaces(0, HALF_UP).toString());
}

export interface TaxSplit {
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/**
 * Split a line's tax over CGST/SGST (intra) or IGST (inter). Intra-state halves the total tax
 * between CGST and SGST, each rounded to the nearest paisa independently (the standard GST
 * treatment). Pure.
 */
export function computeLineTax(
  taxableValuePaise: number | bigint,
  gstRatePct: DecimalInput,
  intraState: boolean,
): TaxSplit {
  const taxable = new Decimal(taxableValuePaise.toString());
  const rate = new Decimal(gstRatePct);
  if (intraState) {
    const half = taxable.times(rate).div(200); // rate% / 2, over 100
    const cgst = Number(half.toDecimalPlaces(0, HALF_UP).toString());
    return { cgstPaise: cgst, sgstPaise: cgst, igstPaise: 0 };
  }
  const igst = taxable.times(rate).div(100);
  return {
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: Number(igst.toDecimalPlaces(0, HALF_UP).toString()),
  };
}

export interface InvoiceLineAmounts {
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface InvoiceTotals {
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Signed adjustment (paise) that brings the grand total to the nearest rupee. */
  roundOffPaise: number;
  totalPaise: number;
}

/** Sum line amounts and round the grand total to the nearest rupee, capturing the signed
 *  round-off (GST invoices round the payable total; the adjustment is disclosed). Accumulation
 *  and rounding go through Decimal — never JS float arithmetic — to honour the money guardrail
 *  (CLAUDE.md rule 2). Paise are exact integers; the boundary cast to `number` is loss-free. Pure. */
export function sumInvoiceTotals(lines: InvoiceLineAmounts[]): InvoiceTotals {
  const zero = new Decimal(0);
  const taxable = lines.reduce((s, l) => s.plus(l.taxableValuePaise), zero);
  const cgst = lines.reduce((s, l) => s.plus(l.cgstPaise), zero);
  const sgst = lines.reduce((s, l) => s.plus(l.sgstPaise), zero);
  const igst = lines.reduce((s, l) => s.plus(l.igstPaise), zero);
  const preRound = taxable.plus(cgst).plus(sgst).plus(igst);
  // Nearest rupee, expressed back in paise: round to whole rupees (÷100, half-up) then ×100.
  const rounded = preRound.div(100).toDecimalPlaces(0, HALF_UP).times(100);
  return {
    taxableValuePaise: Number(taxable.toString()),
    cgstPaise: Number(cgst.toString()),
    sgstPaise: Number(sgst.toString()),
    igstPaise: Number(igst.toString()),
    roundOffPaise: Number(rounded.minus(preRound).toString()),
    totalPaise: Number(rounded.toString()),
  };
}

/** Format paise as ₹ with Indian grouping (lakh/crore), 2 decimals. Pure — for display. */
export function formatPaise(paise: number | bigint): string {
  const n = new Decimal(paise.toString()).div(100);
  const neg = n.isNegative();
  const [intPart, decPart] = n.abs().toFixed(2).split(".");
  // Indian grouping: last 3 digits, then groups of 2.
  const digits = intPart ?? "0";
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }
  return `${neg ? "-" : ""}₹${grouped}.${decPart}`;
}
