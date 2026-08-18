import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { remainingToReceive } from "@/lib/goods-receipt";
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
import { createGRNAction } from "./actions";

export default async function GrnPage({
  searchParams,
}: {
  searchParams: Promise<{ poId?: string; error?: string }>;
}) {
  const { poId, error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "STORES", "read");
  const canWrite = can(actor.role, "STORES", "write");

  const [openPOs, receiving, holdLoc, grns] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { companyId: actor.companyId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      include: { supplier: true },
    }),
    poId
      ? prisma.purchaseOrder.findFirst({
          where: { id: poId, companyId: actor.companyId, status: "OPEN" },
          include: { supplier: true, lines: { include: { item: true } } },
        })
      : Promise.resolve(null),
    prisma.location.findFirst({
      where: { companyId: actor.companyId, isQcHold: true },
      orderBy: { code: "asc" },
    }),
    prisma.goodsReceipt.findMany({
      where: { companyId: actor.companyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { supplier: true, po: true, lines: true },
    }),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Purchasing
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Goods receipt</h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/purchasing/orders">Orders</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!holdLoc ? (
        <p className="text-sm text-destructive">
          No QC-hold location configured. Create a location with QC-hold set before
          receiving.
        </p>
      ) : null}

      {canWrite && receiving ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Receive against <span className="font-mono">{receiving.docNo}</span>
            </CardTitle>
            <CardDescription>
              {receiving.supplier?.name} · goods land on{" "}
              <span className="font-medium">{holdLoc?.name ?? "QC hold"}</span> pending QC
              (S16). Quantities default to the outstanding balance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createGRNAction} className="flex flex-col gap-4">
              <input type="hidden" name="poId" value={receiving.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Docket / invoice no</Label>
                  <Input name="docketNo" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Vehicle no</Label>
                  <Input name="vehicleNo" />
                </div>
              </div>

              <div className="rounded-md border">
                <div className="grid grid-cols-[1fr_110px_110px_120px] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Item</span>
                  <span>Ordered</span>
                  <span>Received</span>
                  <span>Receive now</span>
                </div>
                {receiving.lines.map((l) => {
                  const bal = remainingToReceive(
                    l.qtyOrdered.toString(),
                    l.qtyReceived.toString(),
                  );
                  return (
                    <div
                      key={l.id}
                      className="grid grid-cols-[1fr_110px_110px_120px] items-center gap-2 border-b px-3 py-1.5 last:border-0"
                    >
                      <span className="text-sm">{l.item.code}</span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {l.qtyOrdered.toString()}
                      </span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {l.qtyReceived.toString()}
                      </span>
                      <input type="hidden" name="lineItemId" value={l.item.id} />
                      <input type="hidden" name="linePoLineId" value={l.id} />
                      <Input
                        name="lineQty"
                        inputMode="decimal"
                        defaultValue={bal.gt(0) ? bal.toString() : "0"}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit">Post receipt</Button>
                <Button asChild variant="ghost">
                  <Link href="/purchasing/grn">Cancel</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {canWrite && !receiving ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open orders to receive</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {openPOs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open purchase orders.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {openPOs.map((po) => (
                    <tr key={po.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{po.docNo}</td>
                      <td className="py-2 pr-4">{po.supplier.name}</td>
                      <td className="py-2">
                        <Button asChild variant="secondary" size="sm">
                          <Link href={`/purchasing/grn?poId=${po.id}`}>Receive</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent receipts</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">GRN no</th>
                <th className="py-2 pr-4 font-medium">Supplier</th>
                <th className="py-2 pr-4 font-medium">PO</th>
                <th className="py-2 pr-4 font-medium">Lines</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {grns.map((g) => (
                <tr key={g.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{g.docNo}</td>
                  <td className="py-2 pr-4">{g.supplier?.name ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {g.po?.docNo ?? "—"}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{g.lines.length}</td>
                  <td className="py-2 pr-4">
                    {g.status === "POSTED" ? (
                      "Posted"
                    ) : (
                      <span className="text-muted-foreground">Cancelled</span>
                    )}
                  </td>
                  <td className="py-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/purchasing/grn/${g.id}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {grns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    No goods receipts yet.
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
