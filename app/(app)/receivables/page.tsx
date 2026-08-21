import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import {
  customerAgeing,
  AGEING_BUCKETS,
  AGEING_BUCKET_LABEL,
  type AgeingBucket,
} from "@/lib/receivables";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/state-badge";

export default async function ReceivablesPage() {
  const actor = requireActor(await auth());
  requireAccess(actor, "RECEIVABLES", "read");

  const customers = await prisma.customer.findMany({
    where: { companyId: actor.companyId, isActive: true },
    orderBy: { name: "asc" },
  });

  const asOf = new Date();
  const rows = await Promise.all(
    customers.map(async (c) => ({
      customer: c,
      ageing: await customerAgeing(prisma, actor.companyId, c.id, asOf),
    })),
  );
  const withBalance = rows.filter(
    (r) => r.ageing.outstandingPaise !== 0n || r.ageing.buckets.total !== 0n,
  );

  const totals: Record<AgeingBucket, bigint> & { outstanding: bigint } = {
    current: 0n,
    d0_30: 0n,
    d31_60: 0n,
    d61_90: 0n,
    d90plus: 0n,
    outstanding: 0n,
  };
  for (const r of withBalance) {
    for (const b of AGEING_BUCKETS) totals[b] += r.ageing.buckets[b];
    totals.outstanding += r.ageing.outstandingPaise;
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Receivables"
        title="Outstanding & ageing"
        description="Credit-control view — outstanding = issued invoices − recorded receipts. Statutory books stay in Tally."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By customer</CardTitle>
          <CardDescription>
            A credit-control view — outstanding = issued invoices − recorded receipts.
            Statutory books stay in Tally. Ageing is by invoice due date (IST).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 font-medium">Tier</th>
                {AGEING_BUCKETS.map((b) => (
                  <th key={b} className="py-2 pr-4 text-right font-medium">
                    {AGEING_BUCKET_LABEL[b]}
                  </th>
                ))}
                <th className="py-2 pr-4 text-right font-medium">Outstanding</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {withBalance.map(({ customer, ageing }) => (
                <tr key={customer.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{customer.name}</td>
                  <td className="py-2 pr-4">
                    <Badge tone="neutral">{customer.tier}</Badge>
                  </td>
                  {AGEING_BUCKETS.map((b) => (
                    <td
                      key={b}
                      className={`data py-2 pr-4 text-right ${
                        b === "d90plus" && ageing.buckets[b] > 0n
                          ? "text-state-rejected"
                          : ""
                      }`}
                    >
                      {ageing.buckets[b] > 0n ? formatPaise(ageing.buckets[b]) : "—"}
                    </td>
                  ))}
                  <td className="data py-2 pr-4 text-right font-medium">
                    {formatPaise(ageing.outstandingPaise)}
                  </td>
                  <td className="py-2 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/receivables/${customer.id}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {withBalance.length === 0 ? (
                <tr>
                  <td
                    colSpan={AGEING_BUCKETS.length + 4}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No outstanding receivables.
                  </td>
                </tr>
              ) : (
                <tr className="border-t-2 font-medium">
                  <td className="py-2 pr-4">Total</td>
                  <td className="py-2 pr-4"></td>
                  {AGEING_BUCKETS.map((b) => (
                    <td key={b} className="py-2 pr-4 text-right tabular-nums">
                      {totals[b] > 0n ? formatPaise(totals[b]) : "—"}
                    </td>
                  ))}
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPaise(totals.outstanding)}
                  </td>
                  <td className="py-2"></td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
