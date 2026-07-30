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
import { createCustomerAction, setCustomerActiveAction } from "./actions";
import { CustomerFields } from "./customer-fields";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "MASTERS", "read");
  const canWrite = can(actor.role, "MASTERS", "write");

  const customers = await prisma.customer.findMany({
    where: { companyId: actor.companyId },
    orderBy: { code: "asc" },
    include: { _count: { select: { shipTos: true } } },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            EPE Foam ERP · Masters
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Customers</h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Home</Link>
        </Button>
      </div>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add customer</CardTitle>
            <CardDescription>
              Optionally add a primary ship-to now; manage more on the customer&apos;s
              page. GSTIN is optional. Credit limit is stored, not enforced (Phase 2).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createCustomerAction} className="flex flex-col gap-4">
              <CustomerFields />
              <div className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">Primary ship-to (optional)</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex flex-col gap-1.5">
                    <Label>Label</Label>
                    <Input name="shipLabel" placeholder="Plant" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>GST state code</Label>
                    <Input name="shipStateCode" placeholder="27" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>City</Label>
                    <Input name="shipCity" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>State</Label>
                    <Input name="shipState" />
                  </div>
                </div>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div>
                <Button type="submit">Create customer</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All customers ({customers.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">GSTIN</th>
                <th className="py-2 pr-4 font-medium">Tier</th>
                <th className="py-2 pr-4 font-medium">Credit</th>
                <th className="py-2 pr-4 font-medium">Ship-tos</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                {canWrite ? <th className="py-2 font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{c.code}</td>
                  <td className="py-2 pr-4">{c.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {c.gstin ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{c.tier}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    ₹{c.creditLimit.toString()} · {c.creditDays}d
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{c._count.shipTos}</td>
                  <td className="py-2 pr-4">
                    {c.isActive ? (
                      "Active"
                    ) : (
                      <span className="text-muted-foreground">Inactive</span>
                    )}
                  </td>
                  {canWrite ? (
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/masters/customers/${c.id}/edit`}>Edit</Link>
                        </Button>
                        <form action={setCustomerActiveAction}>
                          <input type="hidden" name="customerId" value={c.id} />
                          <input
                            type="hidden"
                            name="isActive"
                            value={c.isActive ? "false" : "true"}
                          />
                          <Button type="submit" variant="ghost" size="sm">
                            {c.isActive ? "Deactivate" : "Activate"}
                          </Button>
                        </form>
                      </div>
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
