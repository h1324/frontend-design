import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import { salesSummary, type NameValue } from "@/lib/kpi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SalesDashboard() {
  const actor = requireActor(await auth());
  requireAccess(actor, "SALES", "read");

  const s = await salesSummary(prisma, actor.companyId);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Dashboards
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Sales &amp; dispatch
          </h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboards">All dashboards</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary (issued invoices)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Invoices" value={String(s.invoices)} />
          <Stat label="Dispatched kg" value={s.dispatchedKg.toString()} />
          <Stat label="Dispatched m²" value={s.dispatchedM2.toString()} />
          <Stat label="Net sales" value={formatPaise(s.netSalePaise)} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <TopTable title="Top customers" rows={s.byCustomer} />
        <TopTable title="Top SKUs" rows={s.bySku} />
      </div>
    </main>
  );
}

function TopTable({ title, rows }: { title: string; rows: NameValue[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 text-right font-medium">kg</th>
              <th className="py-2 text-right font-medium">Net sales</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2 pr-4">{r.name}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {r.qtyKg.toString()}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatPaise(r.netSalePaise)}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-6 text-center text-muted-foreground">
                  No data yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </CardContent>
    </Card>
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
