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
import { createItemAction, setItemActiveAction } from "./actions";
import { ItemFields } from "./item-fields";

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = requireActor(await auth());
  requireAccess(actor, "MASTERS", "read");
  const canWrite = can(actor.role, "MASTERS", "write");

  const items = await prisma.item.findMany({
    where: { companyId: actor.companyId },
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 lg:px-8">
      <PageHeader
        eyebrow="Masters"
        title="Items"
        description="Foam SKUs — grade, thickness, width, density, colour, HSN and GST rate."
      />

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add item</CardTitle>
            <CardDescription>
              Foam attributes (thickness, width, density, layer count) are required for
              Finished Good and WIP Roll types.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createItemAction} className="flex flex-col gap-4">
              <ItemFields />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div>
                <Button type="submit">Create item</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catalogue ({items.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Spec</th>
                <th className="py-2 pr-4 font-medium">HSN</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                {canWrite ? <th className="py-2 font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{i.code}</td>
                  <td className="py-2 pr-4">{i.name}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{i.type}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {i.thickness_mm
                      ? `${i.thickness_mm}mm · ${i.width_mm}mm · ${i.density_kg_m3}kg/m³${
                          i.layerCount && i.layerCount > 1 ? ` · ${i.layerCount}L` : ""
                        }`
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{i.hsnCode ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {i.isActive ? (
                      "Active"
                    ) : (
                      <span className="text-muted-foreground">Inactive</span>
                    )}
                  </td>
                  {canWrite ? (
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/masters/items/${i.id}/edit`}>Edit</Link>
                        </Button>
                        <form action={setItemActiveAction}>
                          <input type="hidden" name="itemId" value={i.id} />
                          <input
                            type="hidden"
                            name="isActive"
                            value={i.isActive ? "false" : "true"}
                          />
                          <Button type="submit" variant="ghost" size="sm">
                            {i.isActive ? "Deactivate" : "Activate"}
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
