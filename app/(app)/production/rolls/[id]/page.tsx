import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { labelModelFromRoll, labelFieldLines } from "@/lib/rolls";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB"); // DD/MM/YYYY (Indian convention)
}

export default async function RollDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = requireActor(await auth());
  requireAccess(actor, "PRODUCTION", "read");
  const canWrite = can(actor.role, "PRODUCTION", "write");

  const roll = await prisma.roll.findFirst({
    where: { id, companyId: actor.companyId },
    include: { item: true, lot: true, location: true },
  });
  if (!roll) notFound();

  const label = labelModelFromRoll(roll);
  const fields = labelFieldLines(label);

  const theoretical = roll.qtyKgTheoretical.toString();
  const actualKg = roll.qtyKgActual.toString();
  const variance = roll.qtyKgActual.minus(roll.qtyKgTheoretical).toString();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Production
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
            {roll.rollNo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {roll.item.code} — {roll.item.name} ·{" "}
            {roll.lot ? (
              <Link href={`/production/lots/${roll.lot.id}`} className="underline">
                {roll.lot.lotNo}
              </Link>
            ) : (
              "no lot"
            )}{" "}
            · {roll.location.code}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border px-3 py-1 text-xs font-medium">
            {roll.state}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/production/rolls">All rolls</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attributes</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Field label="Net (actual) kg" value={actualKg} />
            <Field label="Theoretical kg" value={theoretical} />
            <Field label="Weight variance kg" value={variance} />
            <Field label="Area m²" value={roll.qtyM2.toString()} />
            <Field label="Length m" value={roll.length_m.toString()} />
            <Field label="Width m" value={roll.width_m.toString()} />
            <Field label="Thickness mm" value={label.thicknessMm} />
            <Field label="Density kg/m³" value={roll.densityKgM3.toString()} />
            <Field label="GSM" value={label.gsm} />
            <Field
              label="Produced"
              value={fmtDate(roll.lot?.productionDate ?? roll.createdAt)}
            />
            <Field label="Aging-ready" value={fmtDate(roll.agingReadyDate)} />
            <Field label="Label prints" value={String(roll.labelPrintCount)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Label</CardTitle>
            <CardDescription>
              Plain printed label — no barcode. The roll number is the identifier.
              {roll.labelPrintedAt
                ? ` Last printed ${roll.labelPrintedAt.toLocaleString("en-GB")}.`
                : " Not printed yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-md border p-4 font-mono text-xs leading-relaxed">
              <div className="text-[10px] tracking-widest text-muted-foreground">
                EPE FOAM ROLL
              </div>
              <div className="mt-1 text-lg font-semibold">{label.rollNo}</div>
              <div className="mt-2 flex flex-col gap-0.5 text-muted-foreground">
                {fields.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </div>
            {canWrite ? (
              <form
                method="post"
                action={`/production/rolls/${roll.id}/label`}
                target="_blank"
              >
                <Button type="submit">
                  {roll.labelPrintCount > 0 ? "Reprint label (PDF)" : "Print label (PDF)"}
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">
                  Opens a PDF in a new tab and logs the print.
                </p>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
