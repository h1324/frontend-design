import { PageHeader } from "@/components/ui/page-header";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { upsertCostRateAction } from "../actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const KINDS = ["LABOUR", "OVERHEAD", "ENERGY"] as const;
const BASES = ["PER_KG", "PER_HOUR", "PER_KWH", "PER_ROLL"] as const;

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB");
}

export default async function CostRatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "COSTING", "read");
  const canWrite = can(actor.role, "COSTING", "write");

  const rates = await prisma.costRate.findMany({
    where: { companyId: actor.companyId },
    orderBy: [{ kind: "asc" }, { effectiveFrom: "desc" }],
  });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Costing"
        title="Cost rates"
        description="Effective-dated energy, labour and overhead rates that feed batch costing."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a rate</CardTitle>
            <CardDescription>
              Effective-dated conversion-cost rates. A lot costs at the rate in force on
              its production date, so add a new row (don&apos;t edit) when a rate changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={upsertCostRateAction}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label>Kind</Label>
                <select name="kind" className={selectClass}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Rate (₹)</Label>
                <Input name="rate" inputMode="decimal" required placeholder="0.00" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Basis</Label>
                <select name="basis" className={selectClass} defaultValue="PER_KG">
                  {BASES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Effective from</Label>
                <Input type="date" name="effectiveFrom" required />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button type="submit">Add rate</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rates</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Kind</th>
                <th className="py-2 pr-4 font-medium">Rate</th>
                <th className="py-2 pr-4 font-medium">Basis</th>
                <th className="py-2 pr-4 font-medium">From</th>
                <th className="py-2 font-medium">To</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{r.kind}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatPaise(r.ratePaise)}</td>
                  <td className="py-2 pr-4">{r.basis}</td>
                  <td className="py-2 pr-4">{fmtDate(r.effectiveFrom)}</td>
                  <td className="py-2">{fmtDate(r.effectiveTo)}</td>
                </tr>
              ))}
              {rates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No cost rates yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
