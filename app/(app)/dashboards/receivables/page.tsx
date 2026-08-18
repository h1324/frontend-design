import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import { receivablesSummary } from "@/lib/kpi";
import { AGEING_BUCKETS, AGEING_BUCKET_LABEL } from "@/lib/receivables";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const TIERS = ["A", "B", "C", "UNGRADED"] as const;

export default async function ReceivablesDashboard() {
  const actor = requireActor(await auth());
  requireAccess(actor, "RECEIVABLES", "read");

  const s = await receivablesSummary(prisma, actor.companyId);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Dashboards
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Receivables</h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboards">All dashboards</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ageing (all customers)</CardTitle>
          <CardDescription>
            Outstanding = issued invoices − recorded receipts, aged by invoice due date
            (IST). The book of record stays in Tally.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {AGEING_BUCKETS.map((b) => (
            <Stat
              key={b}
              label={AGEING_BUCKET_LABEL[b]}
              value={formatPaise(s.buckets[b])}
            />
          ))}
          <Stat label="Outstanding" value={formatPaise(s.outstandingPaise)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer tier mix</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-4 gap-4">
          {TIERS.map((t) => (
            <Stat key={t} label={`Tier ${t}`} value={String(s.tierMix[t] ?? 0)} />
          ))}
        </CardContent>
      </Card>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}
