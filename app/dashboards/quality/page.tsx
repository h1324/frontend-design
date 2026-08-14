import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { qualitySummary } from "@/lib/kpi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function QualityDashboard() {
  const actor = requireActor(await auth());
  requireAccess(actor, "QC", "read");

  const s = await qualitySummary(prisma, actor.companyId);
  const passRate =
    s.inspections > 0 ? `${((s.passed / s.inspections) * 100).toFixed(1)}%` : "—";

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Dashboards
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Quality</h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboards">All dashboards</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">QC dispositions</CardTitle>
          <CardDescription>
            Inspections of incoming GRN lines and produced rolls. Rejected rolls are
            removed from sellable stock.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Inspections" value={String(s.inspections)} />
          <Stat label="Passed" value={String(s.passed)} />
          <Stat label="Failed" value={String(s.failed)} />
          <Stat label="Partial" value={String(s.partial)} />
          <Stat label="Pass rate" value={passRate} />
          <Stat label="Rejected rolls" value={String(s.rejectedRolls)} />
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
