// lib/einvoice/provider.ts — IRP / e-way-bill provider abstraction (spec S23).
// The real GSP adapter is chosen by config; a deterministic MockProvider ships as the default so
// the flow (and tests/demos) run with no external credentials or network. Secrets are injected,
// never imported here (CLAUDE.md / repo hygiene).

import { createHash } from "node:crypto";

/** The normalised IRP payload built from an invoice (see `buildIrpPayload`). Never carries
 *  secrets — just the document facts the IRP needs. */
export interface IrpPayload {
  docNo: string;
  docDate: string; // DD/MM/YYYY
  sellerGstin: string;
  buyerGstin: string | null;
  placeOfSupply: string; // 2-digit state code
  taxableValuePaise: string;
  totalPaise: string;
  items: {
    itemId: string;
    description: string;
    hsn: string | null;
    qty: string;
    taxableValuePaise: string;
    gstRatePct: string;
  }[];
}

export interface IrnResult {
  irn: string;
  signedQr: string;
  ackNo: string;
  ackDate: Date;
}
export interface EwbResult {
  ewbNo: string;
  validTill: Date;
}

/** What every IRP/e-way-bill provider must implement. The real adapter targets the chosen GSP's
 *  schema; this interface is all `lib/einvoice/einvoice.ts` depends on. */
export interface EInvoiceProvider {
  readonly name: string;
  generateIrn(payload: IrpPayload, at: Date): Promise<IrnResult>;
  cancelIrn(irn: string, reason: string): Promise<void>;
  generateEwayBill(payload: IrpPayload, distanceKm: number, at: Date): Promise<EwbResult>;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** A deterministic offline provider: derives a stable 64-hex IRN, signed QR and EWB number from
 *  the payload so runs are reproducible with no network. NOT for production filing. */
export class MockProvider implements EInvoiceProvider {
  readonly name = "MOCK";

  async generateIrn(payload: IrpPayload, at: Date): Promise<IrnResult> {
    const irn = sha256(
      `irn|${payload.sellerGstin}|${payload.docNo}|${payload.totalPaise}`,
    );
    const signedQr = Buffer.from(`MOCK-QR:${irn}`).toString("base64");
    const ackNo = (BigInt("0x" + irn.slice(0, 12)) % 10_000_000_000n).toString();
    return { irn, signedQr, ackNo, ackDate: at };
  }

  async cancelIrn(): Promise<void> {
    // No-op for the mock; a real provider calls the IRP cancel endpoint.
  }

  async generateEwayBill(
    payload: IrpPayload,
    distanceKm: number,
    at: Date,
  ): Promise<EwbResult> {
    const ewbNo = (
      BigInt("0x" + sha256(`ewb|${payload.docNo}`).slice(0, 12)) % 1_000_000_000_000n
    )
      .toString()
      .padStart(12, "0");
    // NIC validity: one day per 200 km slab, minimum one day.
    const days = Math.max(1, Math.ceil((distanceKm || 1) / 200));
    const validTill = new Date(at.getTime() + days * 86_400_000);
    return { ewbNo, validTill };
  }
}

export const mockProvider = new MockProvider();
