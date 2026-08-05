// lib/items.ts — item master service and validation (spec S5).
// Validation is pure (testable without a DB); the service functions enforce authorization
// (MASTERS write), write audit rows, and keep `code` immutable.

import type { ItemType, Prisma, SurfaceTreatment, Item } from "@prisma/client";
import { Decimal, type DecimalInput } from "./decimal.js";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

/** Types whose foam attributes (dims, density, layer count) are mandatory. */
const FOAM_TYPES: ReadonlySet<ItemType> = new Set<ItemType>([
  "FINISHED_GOOD",
  "WIP_ROLL",
]);
const UOM_BASES: ReadonlySet<string> = new Set(["KG", "M2", "NOS", "LITRE"]);

/** Density outside this band is unusual for EPE — a soft warning, never a hard block. */
const DENSITY_MIN = 15;
const DENSITY_MAX = 45;

export interface ItemInput {
  code: string;
  name: string;
  type: ItemType;
  uomBase: string;
  hsnCode?: string | null;
  gstRatePct?: DecimalInput | null;
  grade?: string | null;
  thickness_mm?: DecimalInput | null;
  width_mm?: DecimalInput | null;
  density_kg_m3?: DecimalInput | null;
  colour?: string | null;
  layerCount?: number | null;
  surfaceTreatment?: SurfaceTreatment | null;
  agingDays?: number | null;
  reorderLevel?: DecimalInput | null;
}

/** Fields that may change after creation. `code` and `type` are deliberately excluded. */
export type ItemPatch = Partial<Omit<ItemInput, "code" | "type">>;

export class ItemValidationError extends Error {
  override name = "ItemValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

const HSN_RE = /^\d{2}(?:\d{2}){0,3}$/; // 2, 4, 6 or 8 digits

function checkPositive(
  value: DecimalInput | null | undefined,
  label: string,
  errors: string[],
): void {
  if (value === undefined || value === null || value === "") return;
  if (typeof value === "number") {
    errors.push(`${label}: pass a string/Decimal, not a JS number`);
    return;
  }
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    errors.push(`${label} is not a number`);
    return;
  }
  if (!d.isFinite() || d.lte(0)) errors.push(`${label} must be greater than zero`);
}

/** Validate an item. Returns a list of field errors — empty means valid. Pure. */
export function validateItemInput(input: ItemInput): string[] {
  const errors: string[] = [];

  if (!input.code?.trim()) errors.push("code is required");
  if (!input.name?.trim()) errors.push("name is required");
  if (!UOM_BASES.has(input.uomBase)) {
    errors.push(`uomBase must be one of ${[...UOM_BASES].join(", ")}`);
  }

  if (input.hsnCode != null && input.hsnCode !== "" && !HSN_RE.test(input.hsnCode)) {
    errors.push("hsnCode must be 2, 4, 6 or 8 digits");
  }

  if (input.gstRatePct != null && input.gstRatePct !== "") {
    if (typeof input.gstRatePct === "number") {
      errors.push("gstRatePct: pass a string/Decimal, not a JS number");
    } else {
      let rate: Decimal | null = null;
      try {
        rate = new Decimal(input.gstRatePct);
      } catch {
        errors.push("gstRatePct is not a number");
      }
      if (rate && (!rate.isFinite() || rate.lt(0) || rate.gt(100))) {
        errors.push("gstRatePct must be between 0 and 100");
      }
    }
  }

  checkPositive(input.thickness_mm, "thickness_mm", errors);
  checkPositive(input.width_mm, "width_mm", errors);
  checkPositive(input.density_kg_m3, "density_kg_m3", errors);
  checkPositive(input.reorderLevel, "reorderLevel", errors);

  if (
    input.layerCount != null &&
    (!Number.isInteger(input.layerCount) || input.layerCount < 1)
  ) {
    errors.push("layerCount must be a whole number ≥ 1");
  }
  if (
    input.agingDays != null &&
    (!Number.isInteger(input.agingDays) || input.agingDays < 0)
  ) {
    errors.push("agingDays must be a whole number ≥ 0");
  }

  if (FOAM_TYPES.has(input.type)) {
    if (input.thickness_mm == null)
      errors.push("thickness_mm is required for foam items");
    if (input.width_mm == null) errors.push("width_mm is required for foam items");
    if (input.density_kg_m3 == null)
      errors.push("density_kg_m3 is required for foam items");
    if (input.layerCount == null) errors.push("layerCount is required for foam items");
  }

  return errors;
}

/** Non-blocking advisories (e.g. density outside the usual EPE band). Pure. */
export function itemWarnings(input: ItemInput): string[] {
  const warnings: string[] = [];
  if (input.density_kg_m3 != null && input.density_kg_m3 !== "") {
    try {
      const d = new Decimal(input.density_kg_m3);
      if (d.lt(DENSITY_MIN) || d.gt(DENSITY_MAX)) {
        warnings.push(
          `density ${d.toString()} kg/m³ is outside the usual ${DENSITY_MIN}–${DENSITY_MAX} range`,
        );
      }
    } catch {
      /* invalid values are handled by validateItemInput */
    }
  }
  return warnings;
}

/** Effective aging period for an item: its own override, else the plant default. Pure. */
export function resolveAgingDays(
  itemAgingDays: number | null | undefined,
  companyDefault: number,
): number {
  return itemAgingDays ?? companyDefault;
}

// --- persistence helpers -------------------------------------------------------------

function decOrNull(v: DecimalInput | null | undefined): string | null {
  if (v === undefined || v === null || v === "") return null;
  return String(v);
}

function toData(input: ItemInput) {
  return {
    code: input.code,
    name: input.name,
    type: input.type,
    uomBase: input.uomBase,
    hsnCode: input.hsnCode ?? null,
    gstRatePct: decOrNull(input.gstRatePct),
    grade: input.grade ?? null,
    thickness_mm: decOrNull(input.thickness_mm),
    width_mm: decOrNull(input.width_mm),
    density_kg_m3: decOrNull(input.density_kg_m3),
    colour: input.colour ?? null,
    layerCount: input.layerCount ?? null,
    surfaceTreatment: input.surfaceTreatment ?? null,
    agingDays: input.agingDays ?? null,
    reorderLevel: decOrNull(input.reorderLevel),
  };
}

/** Rebuild an ItemInput from a stored row (for re-validating a patch against invariants). */
function itemToInput(item: Item): ItemInput {
  return {
    code: item.code,
    name: item.name,
    type: item.type,
    uomBase: item.uomBase,
    hsnCode: item.hsnCode,
    gstRatePct: item.gstRatePct?.toString() ?? null,
    grade: item.grade,
    thickness_mm: item.thickness_mm?.toString() ?? null,
    width_mm: item.width_mm?.toString() ?? null,
    density_kg_m3: item.density_kg_m3?.toString() ?? null,
    colour: item.colour,
    layerCount: item.layerCount,
    surfaceTreatment: item.surfaceTreatment,
    agingDays: item.agingDays,
    reorderLevel: item.reorderLevel?.toString() ?? null,
  };
}

// --- service functions ---------------------------------------------------------------

export async function createItem(tx: Tx, actor: Actor, input: ItemInput): Promise<Item> {
  requireAccess(actor, "MASTERS", "write");
  const errors = validateItemInput(input);
  if (errors.length) throw new ItemValidationError(errors);

  const item = await tx.item.create({
    data: { companyId: actor.companyId, ...toData(input) },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Item",
    entityId: item.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: { code: item.code, name: item.name, type: item.type },
  });
  return item;
}

/** Update mutable fields. `code` and `type` cannot change (immutable identity). */
export async function updateItem(
  tx: Tx,
  actor: Actor,
  itemId: string,
  patch: ItemPatch,
): Promise<Item> {
  requireAccess(actor, "MASTERS", "write");
  const current = await tx.item.findFirst({
    where: { id: itemId, companyId: actor.companyId },
  });
  if (!current) throw new AuthzError("item not found");

  // Re-validate the merged result so invariants (foam attrs by type) still hold.
  const merged: ItemInput = { ...itemToInput(current), ...patch };
  const errors = validateItemInput(merged);
  if (errors.length) throw new ItemValidationError(errors);

  const data = toData(merged);
  // never rewrite identity fields
  const { code: _code, type: _type, ...mutable } = data;
  void _code;
  void _type;

  const item = await tx.item.update({ where: { id: itemId }, data: mutable });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Item",
    entityId: itemId,
    action: "UPDATE",
    actorUserId: actor.userId,
    before: {
      name: current.name,
      hsnCode: current.hsnCode,
      agingDays: current.agingDays,
    },
    after: { name: item.name, hsnCode: item.hsnCode, agingDays: item.agingDays },
  });
  return item;
}

export async function setItemActive(
  tx: Tx,
  actor: Actor,
  itemId: string,
  isActive: boolean,
): Promise<Item> {
  requireAccess(actor, "MASTERS", "write");
  const current = await tx.item.findFirst({
    where: { id: itemId, companyId: actor.companyId },
  });
  if (!current) throw new AuthzError("item not found");

  const item = await tx.item.update({ where: { id: itemId }, data: { isActive } });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Item",
    entityId: itemId,
    action: isActive ? "ACTIVATE" : "DEACTIVATE",
    actorUserId: actor.userId,
    before: { isActive: current.isActive },
    after: { isActive },
  });
  return item;
}

/** Effective aging period for a stored item, loading its company's default. */
export async function resolveItemAging(tx: Tx, itemId: string): Promise<number> {
  const item = await tx.item.findUniqueOrThrow({
    where: { id: itemId },
    include: { company: { select: { defaultAgingDays: true } } },
  });
  return resolveAgingDays(item.agingDays, item.company.defaultAgingDays);
}
