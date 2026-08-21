// lib/tally/connector.ts — Tally connector abstraction (spec S24).
// The real transport (Tally's HTTP XML gateway on port 9000, or a file drop) is chosen by
// config; a MockConnector ships as the default so the sync runs with no live Tally. Endpoint and
// credentials come from environment, never here (CLAUDE.md / repo hygiene).

import { createHash } from "node:crypto";

/** A sales voucher pushed to Tally (already rendered to XML). */
export interface SalesVoucher {
  xml: string;
  /** ERP-side idempotency key (payload hash). */
  payloadHash: string;
}

/** The Tally acknowledgement for a pushed voucher. */
export interface TallyAck {
  externalRef: string; // Tally voucher GUID / number
}

/** A receipt voucher pulled from Tally, normalised for import. */
export interface InboundReceipt {
  externalRef: string; // Tally voucher GUID — the inbound idempotency key
  ledgerName: string; // the party ledger, mapped back to a customer
  amountPaise: bigint;
  reference: string | null;
  receivedAt: Date;
}

/** What every Tally connector must implement. `lib/tally/tally-sync.ts` depends only on this. */
export interface TallyConnector {
  readonly name: string;
  /** Push a sales voucher; returns Tally's external ref on success (throws on failure). */
  pushSalesVoucher(voucher: SalesVoucher): Promise<TallyAck>;
  /** Push an invoice cancellation voucher. */
  pushCancellation(externalRef: string, docNo: string): Promise<TallyAck>;
  /** Pull receipt vouchers Tally has recorded since `since` (inclusive). */
  pullReceipts(since: Date | null): Promise<InboundReceipt[]>;
}

/**
 * A deterministic offline connector. Push returns a stable external ref derived from the payload
 * hash; pull returns whatever was queued via `queueReceipt` (tests seed it). NOT for production.
 */
export class MockConnector implements TallyConnector {
  readonly name = "MOCK";
  private queued: InboundReceipt[] = [];

  async pushSalesVoucher(voucher: SalesVoucher): Promise<TallyAck> {
    return { externalRef: this.ref("V", voucher.payloadHash) };
  }

  async pushCancellation(externalRef: string): Promise<TallyAck> {
    return { externalRef };
  }

  async pullReceipts(since: Date | null): Promise<InboundReceipt[]> {
    return since ? this.queued.filter((r) => r.receivedAt >= since) : this.queued;
  }

  /** Test/demo helper: seed inbound receipts the next `pullReceipts` will return. */
  queueReceipt(r: InboundReceipt): void {
    this.queued.push(r);
  }

  private ref(prefix: string, seed: string): string {
    const h = createHash("sha256").update(seed).digest("hex").slice(0, 16).toUpperCase();
    return `${prefix}-${h}`;
  }
}

export const mockConnector = new MockConnector();
