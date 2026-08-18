import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateItemAction } from "../../actions";
import { ItemFields } from "../../item-fields";

export default async function EditItemPage({
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

  const item = await prisma.item.findFirst({
    where: { id, companyId: actor.companyId },
  });
  if (!item) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          EPE Foam ERP · Masters
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit item</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-mono">{item.code}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateItemAction} className="flex flex-col gap-4">
            <input type="hidden" name="itemId" value={item.id} />
            <ItemFields item={item} editing />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="submit">Save changes</Button>
              <Button asChild variant="outline">
                <Link href="/masters/items">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
