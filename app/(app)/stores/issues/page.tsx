import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
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
import { createIssueAction, cancelIssueAction } from "../actions";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "STORES", "read");
  const canWrite = can(actor.role, "STORES", "write");

  const where = { companyId: actor.companyId };
  const [items, locations, issues] = await Promise.all([
    prisma.item.findMany({
      where: {
        ...where,
        isActive: true,
        type: { in: ["RAW_MATERIAL", "CONSUMABLE", "PACKING"] },
      },
      orderBy: { code: "asc" },
    }),
    prisma.location.findMany({ where, orderBy: { code: "asc" } }),
    prisma.materialIssue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { lines: { include: { item: true } } },
    }),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Stores
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Material issues</h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/stores/receipts">Receipts</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Issue material to a batch</CardTitle>
            <CardDescription>
              Lowers stock (BULK OUT) — blocked if it would go negative. Tick regrind for
              re-pelletised trim blended back in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={createIssueAction}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div className="flex flex-col gap-1.5">
                <Label>Item</Label>
                <select name="itemId" required className={selectClass}>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.code} — {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Location</Label>
                <select name="locationId" required className={selectClass}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Quantity (base unit)</Label>
                <Input name="qtyBase" inputMode="decimal" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Lot (optional until batches exist)</Label>
                <Input name="lotId" placeholder="lot id / reference" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Note (optional)</Label>
                <Input name="refNote" />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" name="isRegrind" className="h-4 w-4" />
                Regrind
              </label>
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit">Post issue</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent issues</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Doc no</th>
                <th className="py-2 pr-4 font-medium">Lot</th>
                <th className="py-2 pr-4 font-medium">Lines</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                {canWrite ? <th className="py-2 font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {issues.map((iss) => (
                <tr key={iss.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-4 font-mono text-xs">{iss.docNo}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {iss.lotId ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {iss.lines
                      .map(
                        (l) =>
                          `${l.item.code} ×${l.qtyBase.toString()}${l.isRegrind ? " (regrind)" : ""}`,
                      )
                      .join(", ")}
                  </td>
                  <td className="py-2 pr-4">
                    {iss.status === "POSTED" ? (
                      "Posted"
                    ) : (
                      <span className="text-muted-foreground">Cancelled</span>
                    )}
                  </td>
                  {canWrite ? (
                    <td className="py-2">
                      {iss.status === "POSTED" ? (
                        <form action={cancelIssueAction}>
                          <input type="hidden" name="id" value={iss.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Cancel
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
