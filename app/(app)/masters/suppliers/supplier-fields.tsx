import type { Supplier } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SUPPLY_TAGS } from "@/lib/suppliers";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Shared supplier form fields. In edit mode, `code` is read-only (immutable). */
export function SupplierFields({
  supplier,
  editing = false,
}: {
  supplier?: Supplier;
  editing?: boolean;
}) {
  const address = asRecord(supplier?.addressJson);
  const contact = asRecord(supplier?.contactJson);
  const supplies = Array.isArray(supplier?.suppliesJson)
    ? (supplier?.suppliesJson as string[])
    : [];
  const s = (v: unknown): string => (v == null ? "" : String(v));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Code">
          {editing ? (
            <Input value={s(supplier?.code)} readOnly className="bg-muted" />
          ) : (
            <Input name="code" required defaultValue={s(supplier?.code)} />
          )}
        </Field>
        <Field label="Name">
          <Input name="name" required defaultValue={s(supplier?.name)} />
        </Field>
        <Field label="Legal name">
          <Input name="legalName" defaultValue={s(supplier?.legalName)} />
        </Field>
        <Field label="GSTIN (blank if unregistered)">
          <Input
            name="gstin"
            defaultValue={s(supplier?.gstin)}
            placeholder="27ABCDE1234F1Z5"
          />
        </Field>
        <Field label="Payment terms">
          <Input name="paymentTerms" defaultValue={s(supplier?.paymentTerms)} />
        </Field>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Supplies</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {SUPPLY_TAGS.map((tag) => (
            <label key={tag} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="supplies"
                value={tag}
                defaultChecked={supplies.includes(tag)}
                className="h-4 w-4"
              />
              {tag}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Address line">
          <Input name="line1" defaultValue={s(address.line1)} />
        </Field>
        <Field label="City">
          <Input name="city" defaultValue={s(address.city)} />
        </Field>
        <Field label="State">
          <Input name="state" defaultValue={s(address.state)} />
        </Field>
        <Field label="Pincode">
          <Input name="pincode" defaultValue={s(address.pincode)} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Contact person">
          <Input name="person" defaultValue={s(contact.person)} />
        </Field>
        <Field label="Phone">
          <Input name="phone" defaultValue={s(contact.phone)} />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" defaultValue={s(contact.email)} />
        </Field>
      </div>
    </div>
  );
}
