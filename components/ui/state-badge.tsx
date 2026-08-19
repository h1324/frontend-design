import type { ReactNode } from "react";

// The app-wide status pill. Tones map to the "state as temperature" language so a status reads
// the same colour on the console, a roll list, a sales order, or the Tally sync board.

const toneClass = {
  curing: "bg-state-curing-soft text-state-curing",
  available: "bg-state-available-soft text-state-available",
  allocated: "bg-state-allocated-soft text-state-allocated",
  dispatched: "bg-state-dispatched-soft text-state-dispatched",
  rejected: "bg-state-rejected-soft text-state-rejected",
  brand: "bg-brand-soft text-brand",
  neutral: "bg-secondary text-muted-foreground",
} as const;

export type Tone = keyof typeof toneClass;

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${toneClass[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// Status enum → tone. Covers roll state (S3/S12), credit (S18), QC (S16), order/PO/lot
// lifecycles, invoice, Tally sync (S24), quotations & price contracts (S25), mobile submissions
// (S27). Unknown values fall back to neutral.
const TONE_BY_VALUE: Record<string, Tone> = {
  // roll / stock
  CURING: "curing",
  AVAILABLE: "available",
  ALLOCATED: "allocated",
  DISPATCHED: "dispatched",
  CONSUMED: "dispatched",
  REJECTED: "rejected",
  CANCELLED: "neutral",
  // credit
  OK: "available",
  BLOCKED: "rejected",
  OVERRIDDEN: "curing",
  // QC
  PENDING: "curing",
  PASSED: "available",
  FAILED: "rejected",
  PARTIAL: "curing",
  // order / lot / PO lifecycle
  DRAFT: "neutral",
  OPEN: "allocated",
  CONFIRMED: "available",
  PARTIALLY_FULFILLED: "allocated",
  FULFILLED: "dispatched",
  CLOSED: "dispatched",
  POSTED: "available",
  // invoice / e-invoice
  ISSUED: "available",
  GENERATED: "available",
  // quotations / price contracts (S25)
  SENT: "allocated",
  WON: "available",
  LOST: "neutral",
  EXPIRED: "neutral",
  ACTIVE: "available",
  // Tally sync (S24) / mobile (S27)
  ACK: "available",
  APPLIED: "available",
  RECEIVED: "allocated",
  SKIPPED: "neutral",
  ERROR: "rejected",
  SUPERSEDED: "neutral",
};

function label(value: string): string {
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A status pill coloured by the state-as-temperature language. */
export function StateBadge({ value, className }: { value: string; className?: string }) {
  const tone = TONE_BY_VALUE[value] ?? "neutral";
  return (
    <Badge tone={tone} className={className}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />
      {label(value)}
    </Badge>
  );
}
