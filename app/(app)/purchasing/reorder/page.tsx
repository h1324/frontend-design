import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { reorderBoard, DEFAULT_WINDOW_DAYS } from "@/lib/reorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StateBadge } from "@/components/ui/state-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  runReorderScanAction,
  draftPoAction,
  dismissSuggestionAction,
  setReorderPolicyAction,
} from "./actions";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function num(v: { toDecimalPlaces: (n: number) => { toString: () => string } }, dp = 2) {
  return v.toDecimalPlaces(dp).toString();
}

export default async function ReorderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "STORES", "read");
  const canWrite = can(actor.role, "STORES", "write");

  const [board, openSuggestions, policyItems] = await Promise.all([
    reorderBoard(prisma, actor),
    prisma.reorderSuggestion.findMany({
      where: { companyId: actor.companyId, status: "OPEN" },
      orderBy: { asOf: "desc" },
      include: { item: true, preferredSupplier: true },
    }),
    // Every reorder-eligible item (configured or not) so the policy form can onboard a new one.
    prisma.item.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true,
        type: { in: ["RAW_MATERIAL", "CONSUMABLE", "PACKING"] },
      },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        leadTimeDays: true,
        reorderPolicy: true,
      },
    }),
  ]);

  const belowCount = board.filter((l) => l.belowPoint).length;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Purchasing"
        title="Predictive reorder"
        description="Consumption-driven buy alerts for raw materials and consumables — reorder point from lead-time demand plus safety stock, and a suggested purchase quantity. Suggestions are advisory; a buyer confirms every PO."
        actions={
          canWrite ? (
            <form action={runReorderScanAction}>
              <Button type="submit" size="sm">
                Run scan
              </Button>
            </form>
          ) : null
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <p className="text-sm text-muted-foreground">
        {belowCount > 0 ? (
          <>
            <span className="font-medium text-foreground">{belowCount}</span> item
            {belowCount === 1 ? "" : "s"} at or below reorder point. Consumption is the
            trailing {DEFAULT_WINDOW_DAYS}-day moving average; on-hand excludes QC-hold
            and reject stock.
          </>
        ) : (
          <>All watched items are above their reorder point.</>
        )}
      </p>

      {/* --- open suggestions (materialised snapshots) --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open suggestions</CardTitle>
          <CardDescription>
            Snapshots from the last scan — the numbers a buyer acts on stay fixed even as
            consumption keeps moving. Draft a PO to the preferred supplier, or dismiss
            with a reason.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="py-2 pr-4 text-right font-medium">On hand</th>
                <th className="py-2 pr-4 text-right font-medium">Reorder pt</th>
                <th className="py-2 pr-4 text-right font-medium">Avg/day</th>
                <th className="py-2 pr-4 text-right font-medium">Suggested</th>
                <th className="py-2 pr-4 font-medium">Supplier</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {openSuggestions.map((s) => (
                <tr key={s.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-4">
                    <div className="font-medium">{s.item.code}</div>
                    <div className="text-xs text-muted-foreground">{s.item.name}</div>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {s.onHandQty.toString()} {s.item.uomBase}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {s.reorderPoint.toString()}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {s.avgDailyConsumption.toString()}
                  </td>
                  <td className="py-2 pr-4 text-right font-medium tabular-nums">
                    {s.suggestedQty.toString()} {s.item.uomBase}
                  </td>
                  <td className="py-2 pr-4">
                    {s.preferredSupplier ? (
                      s.preferredSupplier.name
                    ) : (
                      <span className="text-xs text-muted-foreground">no history</span>
                    )}
                  </td>
                  <td className="py-2">
                    {canWrite ? (
                      <div className="flex flex-col items-end gap-1.5">
                        <form action={draftPoAction}>
                          <input type="hidden" name="suggestionId" value={s.id} />
                          <Button
                            type="submit"
                            size="sm"
                            disabled={!s.preferredSupplierId}
                            title={
                              s.preferredSupplierId
                                ? undefined
                                : "No preferred supplier — raise the PO manually"
                            }
                          >
                            Draft PO
                          </Button>
                        </form>
                        <form action={dismissSuggestionAction} className="flex gap-1.5">
                          <input type="hidden" name="suggestionId" value={s.id} />
                          <Input
                            name="reason"
                            placeholder="Dismiss reason"
                            required
                            className="h-8 w-36 text-xs"
                          />
                          <Button type="submit" size="sm" variant="ghost">
                            Dismiss
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {openSuggestions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    No open suggestions.{" "}
                    {canWrite
                      ? "Run a scan to raise them from current consumption."
                      : null}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* --- live watch + editable thresholds --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reorder watch</CardTitle>
          <CardDescription>
            Every AUTO_SUGGEST raw-material, consumable and packing item, computed live.
            The reorder point is derived from consumption when a lead time is set; edit
            lead time and safety stock to tune it. Items below point are highlighted.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Item</th>
                <th className="py-2 pr-4 text-right font-medium">On hand</th>
                <th className="py-2 pr-4 text-right font-medium">Avg/day</th>
                <th className="py-2 pr-4 text-right font-medium">Days cover</th>
                <th className="py-2 pr-4 text-right font-medium">Reorder pt</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                {canWrite ? <th className="py-2 font-medium">Lead / safety</th> : null}
              </tr>
            </thead>
            <tbody>
              {board.map((l) => (
                <tr
                  key={l.itemId}
                  className={`border-b align-middle last:border-0 ${
                    l.belowPoint ? "bg-state-curing-soft/40" : ""
                  }`}
                >
                  <td className="py-2 pr-4">
                    <div className="font-medium">{l.code}</div>
                    <div className="text-xs text-muted-foreground">{l.name}</div>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {num(l.onHand, 2)} {l.uomBase}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {num(l.avgDailyConsumption, 3)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {l.daysOfCover ? num(l.daysOfCover, 0) : "∞"}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {num(l.effectiveReorderPoint, 2)}
                  </td>
                  <td className="py-2 pr-4">
                    <StateBadge value={l.belowPoint ? "OPEN" : "OK"} />
                  </td>
                  {canWrite ? (
                    <td className="py-2">
                      <form
                        action={setReorderPolicyAction}
                        className="flex items-center gap-1.5"
                      >
                        <input type="hidden" name="itemId" value={l.itemId} />
                        <Input
                          name="leadTimeDays"
                          inputMode="numeric"
                          placeholder="lead d"
                          className="h-8 w-16 text-xs"
                          aria-label="Lead time (days)"
                        />
                        <Input
                          name="safetyStock"
                          inputMode="decimal"
                          placeholder="safety"
                          className="h-8 w-20 text-xs"
                          aria-label="Safety stock"
                        />
                        <Button type="submit" size="sm" variant="ghost">
                          Save
                        </Button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
              {board.length === 0 ? (
                <tr>
                  <td
                    colSpan={canWrite ? 7 : 6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No AUTO_SUGGEST items configured. Set a lead time on a raw material to
                    start watching it.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Set item policy</CardTitle>
            <CardDescription>
              Configure any raw material, consumable or packing item — set its lead time
              and safety stock so a reorder point can be computed, switch it between
              AUTO_SUGGEST and MANUAL, or pin a manual reorder point where consumption
              history is thin. Threshold changes are audited.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={setReorderPolicyAction}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
            >
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <Label>Item</Label>
                <select name="itemId" required className={selectClass}>
                  {policyItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.code} — {it.name}
                      {it.reorderPolicy === "MANUAL" ? " (manual)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Lead time (d)</Label>
                <Input name="leadTimeDays" inputMode="numeric" placeholder="e.g. 7" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Safety stock</Label>
                <Input name="safetyStock" inputMode="decimal" placeholder="base UOM" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Policy</Label>
                <select name="reorderPolicy" className={selectClass}>
                  <option value="">— unchanged —</option>
                  <option value="AUTO_SUGGEST">AUTO_SUGGEST</option>
                  <option value="MANUAL">MANUAL</option>
                </select>
              </div>
              <Button type="submit">Save policy</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
