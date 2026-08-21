import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { grnLinesPendingQc, rollsPendingQc } from "@/lib/qc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { inspectGrnLineAction, inspectLotAction } from "../actions";

type PendingRoll = Prisma.RollGetPayload<{ include: { item: true; lot: true } }>;

export default async function QcQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "QC", "read");
  const canWrite = can(actor.role, "QC", "write");

  const [grnLines, rolls] = await Promise.all([
    grnLinesPendingQc(prisma, actor.companyId),
    rollsPendingQc(prisma, actor.companyId),
  ]);

  // Group pending rolls by lot for a per-lot sign-off.
  const byLot = new Map<string, { lotNo: string; rolls: PendingRoll[] }>();
  for (const r of rolls) {
    const key = r.lotId ?? "none";
    const entry = byLot.get(key) ?? { lotNo: r.lot?.lotNo ?? "— no lot —", rolls: [] };
    entry.rolls.push(r);
    byLot.set(key, entry);
  }
  const lotGroups = [...byLot.entries()].filter(([k]) => k !== "none");

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Quality"
        title="QC queue"
        description="Density, thickness and appearance checks — hold, release or reject incoming RM and finished rolls."
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Incoming RM on QC hold ({grnLines.length})
          </CardTitle>
          <CardDescription>
            Pass releases stock to free; fail routes it to the reject location; a partial
            passes only the entered quantity.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {grnLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing awaiting incoming QC.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">GRN</th>
                  <th className="py-2 pr-3 font-medium">Item</th>
                  <th className="py-2 pr-3 font-medium">Received</th>
                  {canWrite ? (
                    <th className="py-2 pr-3 font-medium">Passed qty</th>
                  ) : null}
                  {canWrite ? <th className="py-2 font-medium">Disposition</th> : null}
                </tr>
              </thead>
              <tbody>
                {grnLines.map((l) => (
                  <tr key={l.id} className="border-b align-middle last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">{l.grn.docNo}</td>
                    <td className="py-2 pr-3">{l.item.code}</td>
                    <td className="py-2 pr-3 tabular-nums">{l.qtyReceived.toString()}</td>
                    {canWrite ? (
                      <td className="py-2 pr-3" colSpan={2}>
                        <form
                          action={inspectGrnLineAction}
                          className="flex items-center gap-2"
                        >
                          <input type="hidden" name="grnLineId" value={l.id} />
                          <input
                            type="hidden"
                            name="received"
                            value={l.qtyReceived.toString()}
                          />
                          <Input
                            name="passedQty"
                            inputMode="decimal"
                            defaultValue={l.qtyReceived.toString()}
                            className="h-8 w-24 text-xs"
                          />
                          <Input
                            name="remarks"
                            placeholder="remarks"
                            className="h-8 w-40 text-xs"
                          />
                          <Button type="submit" size="sm" variant="secondary">
                            Disposition
                          </Button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Rolls awaiting sign-off ({rolls.length})
          </CardTitle>
          <CardDescription>
            Per-lot sign-off — every roll passes unless ticked to fail. A pass clears the
            QC gate; an aged roll then becomes available. A failed roll goes to REJECTED.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {lotGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rolls awaiting QC.</p>
          ) : (
            lotGroups.map(([lotId, group]) => (
              <form
                key={lotId}
                action={inspectLotAction}
                className="rounded-md border p-3"
              >
                <input type="hidden" name="lotId" value={lotId} />
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-sm">{group.lotNo}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.rolls.length} roll(s) pending
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {group.rolls.map((r) => (
                    <label key={r.id} className="flex items-center gap-3 text-sm">
                      {canWrite ? (
                        <input
                          type="checkbox"
                          name="failRollId"
                          value={r.id}
                          className="h-4 w-4"
                        />
                      ) : null}
                      <span className="font-mono text-xs">{r.rollNo}</span>
                      <span className="text-muted-foreground">
                        {r.item.code} · {r.densityKgM3.toString()} kg/m³
                      </span>
                    </label>
                  ))}
                </div>
                {canWrite ? (
                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      name="remarks"
                      placeholder="remarks"
                      className="h-8 w-48 text-xs"
                    />
                    <Button type="submit" size="sm">
                      Sign off lot (fail ticked)
                    </Button>
                  </div>
                ) : null}
              </form>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
