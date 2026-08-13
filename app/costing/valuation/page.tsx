import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { formatPaise } from "@/lib/gst";
import { itemStockValue } from "@/lib/landed-cost";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ValuationPage() {
  const actor = requireActor(await auth());
  requireAccess(actor, "COSTING", "read");

  const items = await prisma.item.findMany({
    where: {
      companyId: actor.companyId,
      isActive: true,
      type: { in: ["RAW_MATERIAL", "CONSUMABLE", "PACKING"] },
    },
    orderBy: { code: "asc" },
  });

  const rows = await Promise.all(
    items.map(async (it) => ({
      item: it,
      value: await itemStockValue(prisma, actor.companyId, it.id),
    })),
  );
  const withStock = rows.filter(
    (r) => !r.value.qtyOnHand.isZero() || r.item.movingAvgCostPaise !== 0n,
  );
  const totalValue = withStock.reduce((s, r) => s + r.value.valuePaise, 0n);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Costing
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Stock valuation</h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Home</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Raw-material valuation</CardTitle>
          <CardDescription>
            Moving weighted-average landed cost (supplier rate + apportioned inbound
            charges) × on-hand quantity. Landed cost is set when a goods receipt is costed
            (S20).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="py-2 pr-4 font-medium">UOM</th>
                <th className="py-2 pr-4 text-right font-medium">On hand</th>
                <th className="py-2 pr-4 text-right font-medium">Moving avg</th>
                <th className="py-2 text-right font-medium">Stock value</th>
              </tr>
            </thead>
            <tbody>
              {withStock.map(({ item, value }) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    {item.code} — {item.name}
                  </td>
                  <td className="py-2 pr-4">{item.uomBase}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {value.qtyOnHand.toString()}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatPaise(item.movingAvgCostPaise)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatPaise(value.valuePaise)}
                  </td>
                </tr>
              ))}
              {withStock.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No costed stock yet — cost a goods receipt to build valuation.
                  </td>
                </tr>
              ) : (
                <tr className="border-t-2 font-medium">
                  <td className="py-2 pr-4" colSpan={4}>
                    Total on-hand value
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatPaise(totalValue)}
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
