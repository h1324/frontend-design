import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeLotCostAction } from "../../actions";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB");
}

export default async function LotCostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "COSTING", "read");
  const canWrite = can(actor.role, "COSTING", "write");

  const lot = await prisma.lot.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      targetItem: true,
      machine: true,
      cost: true,
      rolls: { orderBy: { rollNo: "asc" } },
    },
  });
  if (!lot) notFound();
  const c = lot.cost;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Costing
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
            {lot.lotNo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lot.targetItem.code} · {lot.machine.code} · {fmtDate(lot.productionDate)} ·{" "}
            {lot.status}
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/production/lots/${lot.id}`}>Lot detail</Link>
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost breakdown</CardTitle>
          <CardDescription>
            RM at moving-average landed cost (S20) + regrind memo + energy/labour/overhead
            from the rates effective on the production date. Cost allocates to output
            rolls by weight.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {c ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <Metric label="RM cost" value={formatPaise(c.rmCostPaise)} />
              <Metric label="Regrind (memo)" value={formatPaise(c.regrindCreditPaise)} />
              <Metric label="Energy" value={formatPaise(c.energyCostPaise)} />
              <Metric label="Labour" value={formatPaise(c.labourCostPaise)} />
              <Metric label="Overhead" value={formatPaise(c.overheadCostPaise)} />
              <Metric label="Total" value={formatPaise(c.totalCostPaise)} />
              <Metric label="Output kg" value={c.outputKg.toString()} />
              <Metric label="Output m²" value={c.outputM2.toString()} />
              <Metric label="Cost / kg" value={formatPaise(c.costPerKgPaise)} />
              <Metric label="Cost / m²" value={formatPaise(c.costPerM2Paise)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not costed yet.{" "}
              {canWrite ? "Compute it below." : "Ask costing to compute it."}
            </p>
          )}
        </CardContent>
      </Card>

      {canWrite ? (
        <form action={computeLotCostAction}>
          <input type="hidden" name="lotId" value={lot.id} />
          <Button type="submit">{c ? "Recompute cost" : "Compute cost"}</Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Idempotent — recompute after issues, rolls, or rates change. Costing never
            touches the stock ledger.
          </p>
        </form>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Output rolls</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Roll</th>
                <th className="py-2 pr-4 text-right font-medium">kg</th>
                <th className="py-2 pr-4 text-right font-medium">m²</th>
                <th className="py-2 text-right font-medium">Roll cost</th>
              </tr>
            </thead>
            <tbody>
              {lot.rolls.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{r.rollNo}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {r.qtyKgActual.toString()}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {r.qtyM2.toString()}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.unitCostPaise != null ? formatPaise(r.unitCostPaise) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
