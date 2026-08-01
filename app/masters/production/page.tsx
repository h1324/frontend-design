import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess, can } from "@/lib/rbac";
import { DOWNTIME_CATEGORIES } from "@/lib/production-masters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import * as A from "./actions";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ActiveCell({
  action,
  id,
  isActive,
  canWrite,
}: {
  action: (fd: FormData) => void;
  id: string;
  isActive: boolean;
  canWrite: boolean;
}) {
  return (
    <td className="py-2">
      {isActive ? "Active" : <span className="text-muted-foreground">Inactive</span>}
      {canWrite ? (
        <form action={action} className="mt-1">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
          <Button type="submit" variant="ghost" size="sm">
            {isActive ? "Deactivate" : "Activate"}
          </Button>
        </form>
      ) : null}
    </td>
  );
}

export default async function ProductionMastersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "MASTERS", "read");
  const canWrite = can(actor.role, "MASTERS", "write");

  const where = { companyId: actor.companyId };
  const [machines, shifts, operators, reasons] = await Promise.all([
    prisma.machine.findMany({ where, orderBy: { code: "asc" } }),
    prisma.shift.findMany({ where, orderBy: { code: "asc" } }),
    prisma.operator.findMany({ where, orderBy: { code: "asc" } }),
    prisma.downtimeReason.findMany({ where, orderBy: { code: "asc" } }),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Masters
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Production masters
          </h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Home</Link>
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* Machines */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Machines ({machines.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Capacity (kg/h)</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-4 font-mono text-xs">{m.code}</td>
                  <td className="py-2 pr-4" colSpan={2}>
                    {canWrite ? (
                      <form
                        action={A.updateMachineAction}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="id" value={m.id} />
                        <Input name="name" defaultValue={m.name} className="h-9 w-48" />
                        <Input
                          name="ratedCapacityKgHr"
                          defaultValue={m.ratedCapacityKgHr?.toString() ?? ""}
                          className="h-9 w-28"
                          inputMode="decimal"
                        />
                        <Button type="submit" variant="outline" size="sm">
                          Save
                        </Button>
                      </form>
                    ) : (
                      `${m.name} · ${m.ratedCapacityKgHr?.toString() ?? "—"}`
                    )}
                  </td>
                  <ActiveCell
                    action={A.setMachineActiveAction}
                    id={m.id}
                    isActive={m.isActive}
                    canWrite={canWrite}
                  />
                </tr>
              ))}
            </tbody>
          </table>
          {canWrite ? (
            <form
              action={A.createMachineAction}
              className="flex flex-wrap items-end gap-2"
            >
              <Input name="code" placeholder="Code" required className="w-32" />
              <Input name="name" placeholder="Name" required className="w-56" />
              <Input
                name="ratedCapacityKgHr"
                placeholder="kg/h"
                className="w-28"
                inputMode="decimal"
              />
              <Button type="submit" size="sm">
                Add machine
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {/* Shifts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shifts ({shifts.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Name / times</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-4 font-mono text-xs">{s.code}</td>
                  <td className="py-2 pr-4">
                    {canWrite ? (
                      <form
                        action={A.updateShiftAction}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="id" value={s.id} />
                        <Input name="name" defaultValue={s.name} className="h-9 w-48" />
                        <Input
                          name="startTime"
                          defaultValue={s.startTime}
                          className="h-9 w-24"
                          placeholder="HH:MM"
                        />
                        <Input
                          name="endTime"
                          defaultValue={s.endTime}
                          className="h-9 w-24"
                          placeholder="HH:MM"
                        />
                        <Button type="submit" variant="outline" size="sm">
                          Save
                        </Button>
                      </form>
                    ) : (
                      `${s.name} · ${s.startTime}–${s.endTime}`
                    )}
                  </td>
                  <ActiveCell
                    action={A.setShiftActiveAction}
                    id={s.id}
                    isActive={s.isActive}
                    canWrite={canWrite}
                  />
                </tr>
              ))}
            </tbody>
          </table>
          {canWrite ? (
            <form action={A.createShiftAction} className="flex flex-wrap items-end gap-2">
              <Input name="code" placeholder="Code" required className="w-24" />
              <Input name="name" placeholder="Name" required className="w-48" />
              <Input name="startTime" placeholder="HH:MM" required className="w-24" />
              <Input name="endTime" placeholder="HH:MM" required className="w-24" />
              <Button type="submit" size="sm">
                Add shift
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {/* Operators */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operators ({operators.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((o) => (
                <tr key={o.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-4 font-mono text-xs">{o.code}</td>
                  <td className="py-2 pr-4">
                    {canWrite ? (
                      <form
                        action={A.updateOperatorAction}
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="id" value={o.id} />
                        <Input name="name" defaultValue={o.name} className="h-9 w-56" />
                        <Button type="submit" variant="outline" size="sm">
                          Save
                        </Button>
                      </form>
                    ) : (
                      o.name
                    )}
                  </td>
                  <ActiveCell
                    action={A.setOperatorActiveAction}
                    id={o.id}
                    isActive={o.isActive}
                    canWrite={canWrite}
                  />
                </tr>
              ))}
            </tbody>
          </table>
          {canWrite ? (
            <form
              action={A.createOperatorAction}
              className="flex flex-wrap items-end gap-2"
            >
              <Input name="code" placeholder="Code" required className="w-32" />
              <Input name="name" placeholder="Name" required className="w-56" />
              <Button type="submit" size="sm">
                Add operator
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {/* Downtime reasons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Downtime reasons ({reasons.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Description / category</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {reasons.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-4 font-mono text-xs">{r.code}</td>
                  <td className="py-2 pr-4">
                    {canWrite ? (
                      <form
                        action={A.updateDowntimeReasonAction}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="id" value={r.id} />
                        <Input
                          name="description"
                          defaultValue={r.description}
                          className="h-9 w-56"
                        />
                        <select
                          name="category"
                          defaultValue={r.category}
                          className={selectClass}
                        >
                          {DOWNTIME_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" variant="outline" size="sm">
                          Save
                        </Button>
                      </form>
                    ) : (
                      `${r.description} · ${r.category}`
                    )}
                  </td>
                  <ActiveCell
                    action={A.setDowntimeReasonActiveAction}
                    id={r.id}
                    isActive={r.isActive}
                    canWrite={canWrite}
                  />
                </tr>
              ))}
            </tbody>
          </table>
          {canWrite ? (
            <form
              action={A.createDowntimeReasonAction}
              className="flex flex-wrap items-end gap-2"
            >
              <Input name="code" placeholder="Code" required className="w-28" />
              <Input
                name="description"
                placeholder="Description"
                required
                className="w-56"
              />
              <select name="category" defaultValue="OTHER" className={selectClass}>
                {DOWNTIME_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm">
                Add reason
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
