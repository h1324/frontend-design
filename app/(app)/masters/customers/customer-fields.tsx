import type { Customer } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TIERS = ["A", "B", "C", "UNGRADED"] as const;

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** Shared customer form fields. In edit mode, `code` is read-only (immutable). */
export function CustomerFields({
  customer,
  editing = false,
}: {
  customer?: Customer;
  editing?: boolean;
}) {
  const s = (v: unknown): string => (v == null ? "" : String(v));

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Code">
        {editing ? (
          <Input value={s(customer?.code)} readOnly className="bg-muted" />
        ) : (
          <Input name="code" required defaultValue={s(customer?.code)} />
        )}
      </Field>
      <Field label="Name">
        <Input name="name" required defaultValue={s(customer?.name)} />
      </Field>
      <Field label="Legal name">
        <Input name="legalName" defaultValue={s(customer?.legalName)} />
      </Field>
      <Field label="GSTIN (blank if unregistered)">
        <Input
          name="gstin"
          defaultValue={s(customer?.gstin)}
          placeholder="27AABCU9603R1ZM"
        />
      </Field>
      <Field label="PAN">
        <Input name="pan" defaultValue={s(customer?.pan)} />
      </Field>
      <Field label="Tier">
        <select
          name="tier"
          defaultValue={customer?.tier ?? "UNGRADED"}
          className={selectClass}
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Credit limit (₹)">
        <Input
          name="creditLimit"
          inputMode="decimal"
          defaultValue={customer ? customer.creditLimit.toString() : ""}
        />
      </Field>
      <Field label="Credit days">
        <Input
          name="creditDays"
          inputMode="numeric"
          defaultValue={s(customer?.creditDays)}
        />
      </Field>
      <Field label="Payment terms">
        <Input name="paymentTerms" defaultValue={s(customer?.paymentTerms)} />
      </Field>
      <Field label="Transporter preference">
        <Input
          name="transporterPreference"
          defaultValue={s(customer?.transporterPreference)}
        />
      </Field>
    </div>
  );
}
