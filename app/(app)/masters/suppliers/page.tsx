import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
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
import { createSupplierAction, setSupplierActiveAction } from "./actions";
import { SupplierFields } from "./supplier-fields";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "MASTERS", "read");
  const canWrite = can(actor.role, "MASTERS", "write");

  const suppliers = await prisma.supplier.findMany({
    where: { companyId: actor.companyId },
    orderBy: { code: "asc" },
  });

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Masters"
        title="Suppliers"
        description="Parties the plant buys from — LDPE resin, butane, talc, masterbatch, packing."
      />

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add supplier</CardTitle>
            <CardDescription>
              GSTIN is optional — leave blank for unregistered suppliers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createSupplierAction} className="flex flex-col gap-4">
              <SupplierFields />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div>
                <Button type="submit">Create supplier</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All suppliers ({suppliers.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">GSTIN</th>
                <th className="py-2 pr-4 font-medium">Supplies</th>
                <th className="py-2 pr-4 font-medium">Terms</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                {canWrite ? <th className="py-2 font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((sup) => (
                <tr key={sup.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{sup.code}</td>
                  <td className="py-2 pr-4">{sup.name}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {sup.gstin ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {Array.isArray(sup.suppliesJson)
                      ? (sup.suppliesJson as string[]).join(", ")
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {sup.paymentTerms ?? "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {sup.isActive ? (
                      "Active"
                    ) : (
                      <span className="text-muted-foreground">Inactive</span>
                    )}
                  </td>
                  {canWrite ? (
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/masters/suppliers/${sup.id}/edit`}>Edit</Link>
                        </Button>
                        <form action={setSupplierActiveAction}>
                          <input type="hidden" name="supplierId" value={sup.id} />
                          <input
                            type="hidden"
                            name="isActive"
                            value={sup.isActive ? "false" : "true"}
                          />
                          <Button type="submit" variant="ghost" size="sm">
                            {sup.isActive ? "Deactivate" : "Activate"}
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
