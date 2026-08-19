import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma, RollState } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { lookupRollByNo } from "@/lib/rolls";
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
import { PageHeader } from "@/components/ui/page-header";
import { StateBadge } from "@/components/ui/state-badge";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ROLL_STATES: RollState[] = [
  "CURING",
  "AVAILABLE",
  "ALLOCATED",
  "DISPATCHED",
  "CONSUMED",
  "CANCELLED",
];

export default async function RollsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; itemId?: string; lotId?: string; state?: string }>;
}) {
  const { q, itemId, lotId, state } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "PRODUCTION", "read");

  // Roll-number lookup: an exact hit jumps straight to the roll.
  if (q && q.trim()) {
    const hit = await lookupRollByNo(prisma, actor.companyId, q);
    if (hit) redirect(`/production/rolls/${hit.id}`);
  }

  const where: Prisma.RollWhereInput = {
    companyId: actor.companyId,
    ...(itemId ? { itemId } : {}),
    ...(lotId ? { lotId } : {}),
    ...(state ? { state: state as RollState } : {}),
  };
  const [items, lots, rolls] = await Promise.all([
    prisma.item.findMany({
      where: {
        companyId: actor.companyId,
        type: { in: ["FINISHED_GOOD", "WIP_ROLL"] },
      },
      orderBy: { code: "asc" },
    }),
    prisma.lot.findMany({
      where: { companyId: actor.companyId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.roll.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { item: true, lot: true },
    }),
  ]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Production"
        title="Roll registry"
        description="Every numbered unit of output, from curing to dispatch."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/production/lots">Lots</Link>
          </Button>
        }
      />
      {q && q.trim() ? (
        <p className="text-sm text-destructive">
          No roll numbered <span className="font-mono">{q}</span> in this company.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Find a roll</CardTitle>
          <CardDescription>
            Type a roll number to open it directly (no scanner — the number is keyed by
            hand), or filter the list below.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action="/production/rolls" className="flex gap-2">
            <Input
              name="q"
              placeholder="e.g. R2627-000123"
              className="max-w-xs font-mono"
              defaultValue={q ?? ""}
            />
            <Button type="submit">Open</Button>
          </form>

          <form
            action="/production/rolls"
            className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label>SKU</Label>
              <select name="itemId" defaultValue={itemId ?? ""} className={selectClass}>
                <option value="">All</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Lot</Label>
              <select name="lotId" defaultValue={lotId ?? ""} className={selectClass}>
                <option value="">All</option>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.lotNo}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>State</Label>
              <select name="state" defaultValue={state ?? ""} className={selectClass}>
                <option value="">All</option>
                {ROLL_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" variant="secondary">
                Filter
              </Button>
              <Button asChild variant="ghost">
                <Link href="/production/rolls">Clear</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rolls</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Roll no</th>
                <th className="py-2 pr-4 font-medium">SKU</th>
                <th className="py-2 pr-4 font-medium">Lot</th>
                <th className="py-2 pr-4 font-medium">Net kg</th>
                <th className="py-2 pr-4 font-medium">Density</th>
                <th className="py-2 pr-4 font-medium">State</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rolls.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="data py-2 pr-4 text-xs">{r.rollNo}</td>
                  <td className="py-2 pr-4">{r.item.code}</td>
                  <td className="data py-2 pr-4 text-xs text-muted-foreground">
                    {r.lot?.lotNo ?? "—"}
                  </td>
                  <td className="data py-2 pr-4">{r.qtyKgActual.toString()}</td>
                  <td className="data py-2 pr-4">{r.densityKgM3.toString()}</td>
                  <td className="py-2 pr-4">
                    <StateBadge value={r.state} />
                  </td>
                  <td className="py-2">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/production/rolls/${r.id}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {rolls.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    No rolls match.
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
