import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function fmtDate(d: Date): string {
  return d.toLocaleString("en-GB");
}

const resultTone: Record<string, string> = {
  PASS: "text-foreground",
  FAIL: "text-destructive",
  PARTIAL: "text-foreground",
};

export default async function QcInspectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = requireActor(await auth());
  requireAccess(actor, "QC", "read");

  const insp = await prisma.qcInspection.findFirst({
    where: { id, companyId: actor.companyId },
    include: { item: true, readings: true },
  });
  if (!insp) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Quality
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
            {insp.docNo}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {insp.item.code} · {insp.refType === "GRN_LINE" ? "incoming RM" : "roll"} ·{" "}
            {fmtDate(insp.inspectedAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${resultTone[insp.result] ?? ""}`}
          >
            {insp.result}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/qc/queue">QC queue</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disposition</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="Passed qty" value={insp.qtyPassed.toString()} />
          <Field label="Failed qty" value={insp.qtyFailed.toString()} />
          <Field
            label="Reference"
            value={`${insp.refType} · ${insp.refId.slice(0, 8)}`}
          />
          {insp.remarks ? <Field label="Remarks" value={insp.remarks} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Readings ({insp.readings.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {insp.readings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No readings recorded.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Metric</th>
                  <th className="py-2 pr-4 font-medium">Value</th>
                  <th className="py-2 pr-4 font-medium">UOM</th>
                  <th className="py-2 font-medium">In spec</th>
                </tr>
              </thead>
              <tbody>
                {insp.readings.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{r.metric}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {r.value?.toString() ?? "—"}
                    </td>
                    <td className="py-2 pr-4">{r.uom ?? "—"}</td>
                    <td className={`py-2 ${r.withinSpec ? "" : "text-destructive"}`}>
                      {r.withinSpec ? "yes" : "no"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
