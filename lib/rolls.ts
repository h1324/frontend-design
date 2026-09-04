// lib/rolls.ts — roll registry & labels (spec S11).
// Every roll already carries its identity (`rollNo`, assigned at creation in
// `stock-ledger.receiveRoll`) and its physical attributes (S3). This module renders a plain,
// human-readable label (no barcode — the number IS the identifier, keyed by hand), logs each
// print, and looks a roll up by number. Label building/rendering is pure and unit-testable
// without a printer; `printLabel` is the audited mutation.

import type { Prisma } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { gsm as uomGsm } from "./uom.js";
import { requireAccess, type Actor } from "./rbac.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export class RollError extends Error {
  override name = "RollError";
}

// --- label model (pure) --------------------------------------------------------------

/** Everything the label renderer needs, as plain values — no Prisma coupling, so it builds
 *  and tests without a database. */
export interface LabelSource {
  rollNo: string;
  lotNo?: string | null;
  itemCode: string;
  itemName: string;
  /** Actual (weighed) net weight — the quantity of record. Theoretical stays for the KPI. */
  qtyKgActual: DecimalInput;
  qtyM2: DecimalInput;
  length_m: DecimalInput;
  width_m: DecimalInput;
  thicknessMm: DecimalInput;
  densityKgM3: DecimalInput;
  productionDate?: Date | null;
  agingReadyDate?: Date | null;
}

export interface LabelModel {
  rollNo: string;
  lotNo: string;
  sku: string;
  description: string;
  netWeightKg: string;
  areaM2: string;
  lengthM: string;
  widthM: string;
  thicknessMm: string;
  densityKgM3: string;
  gsm: string;
  productionDate: string;
  agingReadyDate: string;
}

function ddmmyyyy(d: Date | null | undefined): string {
  if (!d) return "—";
  const t = new Date(d.getTime() + IST_OFFSET_MS); // read calendar fields in IST
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

/** Assemble the label's display fields from a roll's data. Pure. GSM is derived
 *  (thickness × density) — the areal weight customers sometimes quote. */
export function buildLabelModel(src: LabelSource): LabelModel {
  const thickness = new Decimal(src.thicknessMm);
  const density = new Decimal(src.densityKgM3);
  return {
    rollNo: src.rollNo,
    lotNo: src.lotNo ?? "—",
    sku: src.itemCode,
    description: src.itemName,
    netWeightKg: new Decimal(src.qtyKgActual).toString(),
    areaM2: new Decimal(src.qtyM2).toString(),
    lengthM: new Decimal(src.length_m).toString(),
    widthM: new Decimal(src.width_m).toString(),
    thicknessMm: thickness.toString(),
    densityKgM3: density.toString(),
    // GSM is derived only in lib/uom.ts (CLAUDE.md rule 1). A label is a single-layer view of
    // the roll, so pass one layer; length/width are unused by gsm() but required as valid dims.
    gsm: uomGsm({
      length_m: new Decimal(src.length_m).toString(),
      width_m: new Decimal(src.width_m).toString(),
      layers: [{ thickness_mm: thickness.toString(), density_kg_m3: density.toString() }],
    }).toString(),
    productionDate: ddmmyyyy(src.productionDate),
    agingReadyDate: ddmmyyyy(src.agingReadyDate),
  };
}

/** The label as ordered `label: value` field lines (below the big roll number). Pure —
 *  the single source of truth for both the text and PDF renderers, and what tests assert on. */
export function labelFieldLines(m: LabelModel): string[] {
  return [
    `Lot: ${m.lotNo}`,
    `SKU: ${m.sku}`,
    `Desc: ${m.description}`,
    `Net wt: ${m.netWeightKg} kg`,
    `Area: ${m.areaM2} m2`,
    `Size: ${m.lengthM} m x ${m.widthM} m x ${m.thicknessMm} mm`,
    `Density: ${m.densityKgM3} kg/m3   GSM: ${m.gsm}`,
    `Produced: ${m.productionDate}`,
    `Aging-ready: ${m.agingReadyDate}`,
  ];
}

/** Plain-text label (roll number heading + fields). Pure. */
export function renderLabelText(m: LabelModel): string {
  return [`EPE FOAM ROLL`, m.rollNo, ...labelFieldLines(m)].join("\n");
}

// --- PDF (pure, dependency-free) -----------------------------------------------------

function pdfEscape(s: string): string {
  // Keep the PDF to WinAnsi/ASCII and escape the three delimiter characters.
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
  );
}

/** Render the label as a minimal, valid single-page PDF (Helvetica, no barcode). Built by
 *  hand — no PDF dependency — so it stays pure and testable. 100 mm × 150 mm at 72 dpi. */
export function renderLabelPdf(m: LabelModel): Uint8Array {
  const fields = labelFieldLines(m);
  const content =
    `BT\n` +
    `/F1 9 Tf 18 400 Td (${pdfEscape("EPE FOAM ROLL")}) Tj\n` +
    `/F1 24 Tf 0 -30 Td (${pdfEscape(m.rollNo)}) Tj\n` +
    `/F1 11 Tf 0 -28 Td 15 TL\n` +
    fields.map((line, i) => `${i === 0 ? "" : "T* "}(${pdfEscape(line)}) Tj`).join("\n") +
    `\nET`;

  const objects = [
    `<</Type/Catalog/Pages 2 0 R>>`,
    `<</Type/Pages/Kids[3 0 R]/Count 1>>`,
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 283 425]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>`,
    `<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>`,
    `<</Length ${Buffer.byteLength(content, "latin1")}>>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  const size = objects.length + 1;
  pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${size}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

// --- queries & print logging ---------------------------------------------------------

const rollWithLabelData = {
  include: { item: true, lot: true },
} satisfies Prisma.RollDefaultArgs;

export type RollWithLabelData = Prisma.RollGetPayload<typeof rollWithLabelData>;

/** Total roll thickness (mm) = Σ layer thicknesses, read from the stored layer stack. */
function totalThicknessMm(layersJson: Prisma.JsonValue): Decimal {
  const layers = Array.isArray(layersJson) ? layersJson : [];
  return layers.reduce<Decimal>((sum, l) => {
    const t = (l as { thickness_mm?: string })?.thickness_mm ?? "0";
    return sum.plus(new Decimal(t));
  }, new Decimal(0));
}

/** Build a label model straight from a loaded roll (+ item + lot). */
export function labelModelFromRoll(roll: RollWithLabelData): LabelModel {
  return buildLabelModel({
    rollNo: roll.rollNo,
    lotNo: roll.lot?.lotNo ?? null,
    itemCode: roll.item.code,
    itemName: roll.item.name,
    qtyKgActual: roll.qtyKgActual.toString(),
    qtyM2: roll.qtyM2.toString(),
    length_m: roll.length_m.toString(),
    width_m: roll.width_m.toString(),
    thicknessMm: totalThicknessMm(roll.layersJson),
    densityKgM3: roll.densityKgM3.toString(),
    productionDate: roll.lot?.productionDate ?? roll.createdAt,
    agingReadyDate: roll.agingReadyDate,
  });
}

/** Find a roll by its number within a company (exact, case-insensitive on the typed value). */
export async function lookupRollByNo(
  db: Tx,
  companyId: string,
  rollNo: string,
): Promise<RollWithLabelData | null> {
  const normalized = rollNo.trim().toUpperCase();
  if (!normalized) return null;
  return db.roll.findFirst({
    where: { companyId, rollNo: normalized },
    ...rollWithLabelData,
  });
}

/** Log a label print/reprint: increment the count, stamp the time, and audit it — a
 *  relabelled roll must be traceable (spec S11 rule 3). Returns the roll with label data. */
export async function printLabel(
  tx: Tx,
  actor: Actor,
  rollId: string,
): Promise<RollWithLabelData> {
  requireAccess(actor, "PRODUCTION", "write");
  const roll = await tx.roll.findFirst({
    where: { id: rollId, companyId: actor.companyId },
    ...rollWithLabelData,
  });
  if (!roll) throw new RollError("roll not found");

  const updated = await tx.roll.update({
    where: { id: roll.id },
    data: { labelPrintCount: { increment: 1 }, labelPrintedAt: new Date() },
    ...rollWithLabelData,
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Roll",
    entityId: roll.id,
    action: "LABEL_PRINT",
    actorUserId: actor.userId,
    before: { labelPrintCount: roll.labelPrintCount },
    after: { labelPrintCount: updated.labelPrintCount, rollNo: roll.rollNo },
  });
  return updated;
}
