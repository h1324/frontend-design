import type { Item } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ITEM_TYPES = [
  "FINISHED_GOOD",
  "WIP_ROLL",
  "RAW_MATERIAL",
  "CONSUMABLE",
  "PACKING",
] as const;
const UOM_BASES = ["M2", "KG", "NOS", "LITRE"] as const;
const TREATMENTS = ["PLAIN", "ANTI_STATIC", "LAMINATED", "PERFORATED"] as const;

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

/** Shared item form fields. In edit mode, `code` and `type` are shown read-only (immutable). */
export function ItemFields({
  item,
  editing = false,
}: {
  item?: Item;
  editing?: boolean;
}) {
  const d = <K extends keyof Item>(k: K): string =>
    item?.[k] == null ? "" : String(item[k]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Code">
        {editing ? (
          <Input value={d("code")} readOnly className="bg-muted" />
        ) : (
          <Input name="code" required defaultValue={d("code")} />
        )}
      </Field>

      <Field label="Name">
        <Input name="name" required defaultValue={d("name")} />
      </Field>

      <Field label="Type">
        {editing ? (
          <Input value={d("type")} readOnly className="bg-muted" />
        ) : (
          <select
            name="type"
            defaultValue={item?.type ?? "FINISHED_GOOD"}
            className={selectClass}
          >
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field label="UOM base">
        <select
          name="uomBase"
          defaultValue={item?.uomBase ?? "M2"}
          className={selectClass}
        >
          {UOM_BASES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </Field>

      <Field label="HSN code">
        <Input name="hsnCode" defaultValue={d("hsnCode")} placeholder="2/4/6/8 digits" />
      </Field>

      <Field label="Grade">
        <Input name="grade" defaultValue={d("grade")} />
      </Field>

      <Field label="Thickness (mm)">
        <Input name="thickness_mm" inputMode="decimal" defaultValue={d("thickness_mm")} />
      </Field>

      <Field label="Width (mm)">
        <Input name="width_mm" inputMode="decimal" defaultValue={d("width_mm")} />
      </Field>

      <Field label="Density (kg/m³)">
        <Input
          name="density_kg_m3"
          inputMode="decimal"
          defaultValue={d("density_kg_m3")}
        />
      </Field>

      <Field label="Colour">
        <Input name="colour" defaultValue={d("colour")} />
      </Field>

      <Field label="Layer count">
        <Input name="layerCount" inputMode="numeric" defaultValue={d("layerCount")} />
      </Field>

      <Field label="Surface treatment">
        <select
          name="surfaceTreatment"
          defaultValue={item?.surfaceTreatment ?? ""}
          className={selectClass}
        >
          <option value="">—</option>
          {TREATMENTS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Aging days (blank = plant default)">
        <Input name="agingDays" inputMode="numeric" defaultValue={d("agingDays")} />
      </Field>

      <Field label="Reorder level">
        <Input name="reorderLevel" inputMode="decimal" defaultValue={d("reorderLevel")} />
      </Field>
    </div>
  );
}
