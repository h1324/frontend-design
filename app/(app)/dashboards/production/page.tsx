import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { productionSummary, oeeByLot, type Frac } from "@/lib/kpi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function pct(f: Frac): string {
  return f == null ? "—" : `${(f * 100).toFixed(1)}%`;
}

export default async function ProductionDashboard() {
  const actor = requireActor(await auth());
  requireAccess(actor, "PRODUCTION", "read");

  const [summary, lots] = await Promise.all([
    productionSummary(prisma, actor.companyId),
    oeeByLot(prisma, actor.companyId),
  ]);
  const v = summary.variance;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Dashboards
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Production</h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboards">All dashboards</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary (closed lots)</CardTitle>
          <CardDescription>
            Density/weight variance is a first-class KPI — the spread between theoretical
            and actual weight, surfaced not reconciled.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Lots" value={String(summary.lots)} />
          <Stat label="Output kg" value={summary.outputKg.toString()} />
          <Stat label="Avg yield %" value={summary.avgYieldPct.toFixed(1)} />
          <Stat label="Downtime min" value={String(summary.downtimeMin)} />
          <Stat label="Rejected rolls" value={String(summary.rejectedRolls)} />
          <Stat
            label="Density var % (mean)"
            value={v.count ? `${v.meanPct.toFixed(2)} (${v.minPct}…${v.maxPct})` : "—"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">OEE by lot</CardTitle>
          <CardDescription>
            Availability × performance × quality. Performance needs the machine&apos;s
            rated capacity (kg/hr) — shown as — when unset.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Lot</th>
                <th className="py-2 pr-4 font-medium">Machine</th>
                <th className="py-2 pr-4 text-right font-medium">Output kg</th>
                <th className="py-2 pr-4 text-right font-medium">Avail.</th>
                <th className="py-2 pr-4 text-right font-medium">Perf.</th>
                <th className="py-2 pr-4 text-right font-medium">Qual.</th>
                <th className="py-2 text-right font-medium">OEE</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.lotId} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">
                    <Link href={`/costing/lots/${l.lotId}`} className="underline">
                      {l.lotNo}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{l.machineCode}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {l.outputKg.toString()}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {pct(l.factors.availability)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {pct(l.factors.performance)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {pct(l.factors.quality)}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {pct(l.factors.oee)}
                  </td>
                </tr>
              ))}
              {lots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    No closed lots yet.
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
