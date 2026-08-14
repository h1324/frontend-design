import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import { marginReport } from "@/lib/costing";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function pct(margin: bigint, sale: bigint): string {
  if (sale === 0n) return "—";
  return `${((Number(margin) / Number(sale)) * 100).toFixed(1)}%`;
}

export default async function MarginPage() {
  const actor = requireActor(await auth());
  requireAccess(actor, "COSTING", "read");

  const report = await marginReport(prisma, actor.companyId);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Costing
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Margin by customer
          </h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Home</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sale vs cost</CardTitle>
          <CardDescription>
            Net sale (invoice taxable value) minus the snapshot cost of the dispatched
            rolls (S21). Rolls not yet costed contribute zero cost — compute their lot
            cost to firm up the margin.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 text-right font-medium">Net sale</th>
                <th className="py-2 pr-4 text-right font-medium">Cost</th>
                <th className="py-2 pr-4 text-right font-medium">Margin</th>
                <th className="py-2 text-right font-medium">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.customerId} className="border-b last:border-0">
                  <td className="py-2 pr-4">{r.customerName}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPaise(r.salePaise)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPaise(r.costPaise)}
                  </td>
                  <td
                    className={`py-2 pr-4 text-right tabular-nums ${
                      r.marginPaise < 0n ? "text-destructive" : ""
                    }`}
                  >
                    {formatPaise(r.marginPaise)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {pct(r.marginPaise, r.salePaise)}
                  </td>
                </tr>
              ))}
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No issued invoices yet.
                  </td>
                </tr>
              ) : (
                <tr className="border-t-2 font-medium">
                  <td className="py-2 pr-4">Total</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPaise(report.totals.salePaise)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPaise(report.totals.costPaise)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPaise(report.totals.marginPaise)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {pct(report.totals.marginPaise, report.totals.salePaise)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
