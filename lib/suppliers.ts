// lib/suppliers.ts — supplier master service and validation (spec S6).
// Validation is pure; the service enforces authorization (MASTERS write), writes audit
// rows, keeps `code` immutable, and deactivates rather than deletes.

import { Prisma, type Supplier } from "@prisma/client";
import { requireAccess, AuthzError, type Actor } from "./rbac.js";
import { isValidGstinFormat } from "./gstin.js";
import { writeAudit } from "./audit.js";

type Tx = Prisma.TransactionClient;

/** Material categories a supplier can provide (free tags; not an enum by design). */
export const SUPPLY_TAGS = [
  "LDPE",
  "BUTANE",
  "TALC",
  "GMS",
  "MASTERBATCH",
  "PACKING",
] as const;

export interface SupplierAddress {
  line1?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}
export interface SupplierContact {
  person?: string | null;
  phone?: string | null;
  email?: string | null;
}
export interface SupplierInput {
  code: string;
  name: string;
  legalName?: string | null;
  gstin?: string | null;
  address?: SupplierAddress | null;
  contact?: SupplierContact | null;
  supplies?: string[] | null;
  paymentTerms?: string | null;
}

export type SupplierPatch = Partial<Omit<SupplierInput, "code">>;

export class SupplierValidationError extends Error {
  override name = "SupplierValidationError";
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

/** Validate a supplier. Returns field errors — empty means valid. Pure. */
export function validateSupplierInput(input: SupplierInput): string[] {
  const errors: string[] = [];
  if (!input.code?.trim()) errors.push("code is required");
  if (!input.name?.trim()) errors.push("name is required");
  if (input.gstin != null && input.gstin !== "" && !isValidGstinFormat(input.gstin)) {
    errors.push("gstin must be a valid 15-character GSTIN");
  }
  return errors;
}

// --- persistence helpers -------------------------------------------------------------

function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value == null) return Prisma.DbNull;
  if (Array.isArray(value))
    return value.length ? (value as Prisma.InputJsonValue) : Prisma.DbNull;
  if (typeof value === "object") {
    const cleaned = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => v != null && v !== "",
      ),
    );
    return Object.keys(cleaned).length
      ? (cleaned as Prisma.InputJsonValue)
      : Prisma.DbNull;
  }
  return Prisma.DbNull;
}

function toData(input: SupplierInput) {
  return {
    name: input.name,
    legalName: input.legalName ?? null,
    gstin: input.gstin ? input.gstin : null,
    addressJson: jsonOrDbNull(input.address),
    contactJson: jsonOrDbNull(input.contact),
    suppliesJson: jsonOrDbNull(input.supplies),
    paymentTerms: input.paymentTerms ?? null,
  };
}

// --- service functions ---------------------------------------------------------------

export async function createSupplier(
  tx: Tx,
  actor: Actor,
  input: SupplierInput,
): Promise<Supplier> {
  requireAccess(actor, "MASTERS", "write");
  const errors = validateSupplierInput(input);
  if (errors.length) throw new SupplierValidationError(errors);

  const supplier = await tx.supplier.create({
    data: { companyId: actor.companyId, code: input.code, ...toData(input) },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Supplier",
    entityId: supplier.id,
    action: "CREATE",
    actorUserId: actor.userId,
    after: { code: supplier.code, name: supplier.name, gstin: supplier.gstin },
  });
  return supplier;
}

export async function updateSupplier(
  tx: Tx,
  actor: Actor,
  supplierId: string,
  patch: SupplierPatch,
): Promise<Supplier> {
  requireAccess(actor, "MASTERS", "write");
  const current = await tx.supplier.findFirst({
    where: { id: supplierId, companyId: actor.companyId },
  });
  if (!current) throw new AuthzError("supplier not found");

  const merged: SupplierInput = { code: current.code, name: current.name, ...patch };
  const errors = validateSupplierInput(merged);
  if (errors.length) throw new SupplierValidationError(errors);

  const supplier = await tx.supplier.update({
    where: { id: supplierId },
    data: toData(merged), // `code` is not in toData — immutable
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Supplier",
    entityId: supplierId,
    action: "UPDATE",
    actorUserId: actor.userId,
    before: { name: current.name, gstin: current.gstin },
    after: { name: supplier.name, gstin: supplier.gstin },
  });
  return supplier;
}

export async function setSupplierActive(
  tx: Tx,
  actor: Actor,
  supplierId: string,
  isActive: boolean,
): Promise<Supplier> {
  requireAccess(actor, "MASTERS", "write");
  const current = await tx.supplier.findFirst({
    where: { id: supplierId, companyId: actor.companyId },
  });
  if (!current) throw new AuthzError("supplier not found");

  const supplier = await tx.supplier.update({
    where: { id: supplierId },
    data: { isActive },
  });
  await writeAudit(tx, {
    companyId: actor.companyId,
    entity: "Supplier",
    entityId: supplierId,
    action: isActive ? "ACTIVATE" : "DEACTIVATE",
    actorUserId: actor.userId,
    before: { isActive: current.isActive },
    after: { isActive },
  });
  return supplier;
}

// --- representative seed -------------------------------------------------------------

// PLACEHOLDER suppliers for a greenfield line — one per material category. Replace with
// your actual vendors (names, GSTIN, terms) via the supplier master before go-live.
export const SUPPLIER_SEED: SupplierInput[] = [
  {
    code: "SUP-LDPE",
    name: "LDPE Resin Supplier (placeholder)",
    gstin: "27ABCDE1234F1Z5", // format-valid placeholder — replace with the real GSTIN
    supplies: ["LDPE"],
    paymentTerms: "30 days",
    address: { state: "Maharashtra" },
  },
  {
    code: "SUP-BUTANE",
    name: "Butane / Blowing Agent Supplier (placeholder)",
    supplies: ["BUTANE"],
    paymentTerms: "Advance",
  },
  {
    code: "SUP-ADDITIVES",
    name: "Additives Supplier — talc & GMS (placeholder)",
    supplies: ["TALC", "GMS"],
    paymentTerms: "30 days",
  },
  {
    code: "SUP-MASTERBATCH",
    name: "Masterbatch Supplier (placeholder)",
    supplies: ["MASTERBATCH"],
    paymentTerms: "45 days",
  },
  {
    code: "SUP-PACKING",
    name: "Packing Materials Supplier (placeholder)",
    supplies: ["PACKING"],
    paymentTerms: "30 days",
  },
];
