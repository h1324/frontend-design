import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerFields } from "../../customer-fields";
import {
  updateCustomerAction,
  addShipToAction,
  setDefaultShipToAction,
} from "../../actions";

export default async function EditCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "MASTERS", "write");

  const customer = await prisma.customer.findFirst({
    where: { id, companyId: actor.companyId },
    include: { shipTos: { orderBy: { createdAt: "asc" } } },
  });
  if (!customer) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          EPE Foam ERP · Masters
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit customer</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-mono">{customer.code}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateCustomerAction} className="flex flex-col gap-4">
            <input type="hidden" name="customerId" value={customer.id} />
            <CustomerFields customer={customer} editing />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="submit">Save changes</Button>
              <Button asChild variant="outline">
                <Link href="/masters/customers">Back</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Ship-to addresses ({customer.shipTos.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Label</th>
                <th className="py-2 pr-4 font-medium">State code</th>
                <th className="py-2 pr-4 font-medium">Default</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {customer.shipTos.map((st) => (
                <tr key={st.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{st.label}</td>
                  <td className="py-2 pr-4 font-mono">{st.gstStateCode}</td>
                  <td className="py-2 pr-4">{st.isDefault ? "★ default" : ""}</td>
                  <td className="py-2">
                    {!st.isDefault ? (
                      <form action={setDefaultShipToAction}>
                        <input type="hidden" name="customerId" value={customer.id} />
                        <input type="hidden" name="shipToId" value={st.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Make default
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form action={addShipToAction} className="rounded-md border p-3">
            <input type="hidden" name="customerId" value={customer.id} />
            <p className="mb-2 text-sm font-medium">Add ship-to</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label>Label</Label>
                <Input name="label" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>GST state code</Label>
                <Input name="gstStateCode" required placeholder="27" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>City</Label>
                <Input name="city" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>State</Label>
                <Input name="state" />
              </div>
            </div>
            <div className="mt-3">
              <Button type="submit" variant="outline" size="sm">
                Add ship-to
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
