import Link from "next/link";
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
import {
  createPriceContractAction,
  cancelPriceContractAction,
  createValueDiscountAction,
  cancelValueDiscountAction,
} from "./actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const LINE_ROWS = 4;

function target(scope: string, customerName: string | null, tier: string | null): string {
  return scope === "CUSTOMER" ? (customerName ?? "—") : `Tier ${tier ?? "—"}`;
}

export default async function PriceContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "SALES", "read");
  const canWrite = can(actor.role, "SALES", "write");

  const [customers, items, contracts, tiers] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId: actor.companyId, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.item.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true,
        type: { in: ["FINISHED_GOOD", "WIP_ROLL"] },
      },
      orderBy: { code: "asc" },
    }),
    prisma.priceContract.findMany({
      where: { companyId: actor.companyId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { customer: true, lines: { include: { item: true } } },
    }),
    prisma.valueDiscountTier.findMany({
      where: { companyId: actor.companyId, status: "ACTIVE" },
      orderBy: { minOrderValuePaise: "asc" },
      take: 50,
      include: { customer: true },
    }),
  ]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Sales"
        title="Price contracts"
        description="Customer- and tier-scoped agreed rates, quantity slabs and order-value discounts."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/sales/quotations">Quotations</Link>
          </Button>
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New price contract</CardTitle>
            <CardDescription>
              An agreed rate per item, banded by quantity (rate applies from the min qty
              upward). Customer contracts beat tier contracts; both beat the item list
              price. GST is taken from the item master.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createPriceContractAction} className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Scope</Label>
                  <select name="scope" className={selectClass}>
                    <option value="CUSTOMER">Customer</option>
                    <option value="TIER">Tier</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Customer (if customer scope)</Label>
                  <select name="customerId" className={selectClass}>
                    <option value="">—</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Tier (if tier scope)</Label>
                  <select name="tier" className={selectClass}>
                    <option value="">—</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="UNGRADED">UNGRADED</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 sm:w-1/3">
                <Label>Valid until (optional)</Label>
                <Input type="date" name="validUntil" />
              </div>

              <div className="rounded-md border">
                <div className="grid grid-cols-[1fr_120px_140px] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Item</span>
                  <span>Min qty</span>
                  <span>Rate (₹/unit)</span>
                </div>
                {Array.from({ length: LINE_ROWS }).map((_, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_120px_140px] gap-2 border-b px-3 py-1.5 last:border-0"
                  >
                    <select name="lineItemId" className={selectClass}>
                      <option value="">—</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.code} — {it.name} ({it.uomBase})
                        </option>
                      ))}
                    </select>
                    <Input name="lineMinQty" inputMode="decimal" placeholder="0" />
                    <Input name="lineRate" inputMode="decimal" placeholder="0.00" />
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button type="submit">Create contract</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active contracts</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Contract</th>
                <th className="py-2 pr-4 font-medium">Applies to</th>
                <th className="py-2 pr-4 font-medium">Item bands</th>
                <th className="py-2 pr-4 font-medium">Valid until</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{c.docNo}</td>
                  <td className="py-2 pr-4">
                    {target(c.scope, c.customer?.name ?? null, c.tier)}
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {c.lines.map((l) => (
                      <div key={l.id}>
                        {l.item.code} · ≥{l.minQty.toString()} →{" "}
                        {formatPaise(l.ratePaise)}
                      </div>
                    ))}
                  </td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                    {c.validUntil ? c.validUntil.toLocaleDateString("en-GB") : "open"}
                  </td>
                  <td className="py-2">
                    {canWrite ? (
                      <form action={cancelPriceContractAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Cancel
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {contracts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No active price contracts.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order-value discount tiers</CardTitle>
          <CardDescription>
            A whole-order % off above a pre-tax order value. The second, orthogonal
            pricing axis — it stacks on top of the per-line contract rate. Customer tiers
            beat customer-tier tiers.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canWrite ? (
            <form
              action={createValueDiscountAction}
              className="grid items-end gap-3 sm:grid-cols-5"
            >
              <div className="flex flex-col gap-1.5">
                <Label>Scope</Label>
                <select name="scope" className={selectClass}>
                  <option value="CUSTOMER">Customer</option>
                  <option value="TIER">Tier</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Customer</Label>
                <select name="customerId" className={selectClass}>
                  <option value="">—</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Tier</Label>
                <select name="tier" className={selectClass}>
                  <option value="">—</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="UNGRADED">UNGRADED</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Min order ₹</Label>
                <Input name="minOrderValue" inputMode="decimal" placeholder="0.00" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Discount %</Label>
                <Input name="discountPct" inputMode="decimal" placeholder="0" />
              </div>
              <div className="sm:col-span-5 flex justify-end">
                <Button type="submit" size="sm">
                  Add tier
                </Button>
              </div>
            </form>
          ) : null}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Applies to</th>
                <th className="py-2 pr-4 font-medium">Min order value</th>
                <th className="py-2 pr-4 font-medium">Discount</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    {target(t.scope, t.customer?.name ?? null, t.tier)}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {formatPaise(t.minOrderValuePaise)}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{t.discountPct.toString()}%</td>
                  <td className="py-2">
                    {canWrite ? (
                      <form action={cancelValueDiscountAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Cancel
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {tiers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    No value-discount tiers.
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
