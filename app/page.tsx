import Link from "next/link";
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function Home() {
  const session = await auth();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <div>
        <p className="text-sm font-medium text-muted-foreground">EPE Foam ERP</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Manufacturing operations
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scaffold is live</CardTitle>
          <CardDescription>
            Phase 0 · S0 — the app boots, the database is wired, and auth is enforced.
            Modules land in the sessions that follow.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm">
            <p>
              Signed in as{" "}
              <span className="font-medium">{session?.user?.name ?? "—"}</span>
            </p>
            <p className="text-muted-foreground">
              {session?.user?.email} · {session?.user?.role}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/masters/items">Items</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/masters/suppliers">Suppliers</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/masters/customers">Customers</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/masters/production">Production</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/stores/receipts">Stores</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/purchasing/orders">Purchasing</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/purchasing/grn">Receiving</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/qc/queue">QC</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/production/lots">Lots</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/production/rolls">Rolls</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/production/aging">Aging</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/converting">Converting</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dispatch">Dispatch</Link>
            </Button>
            {session?.user?.role === "ADMIN" ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/users">Users</Link>
              </Button>
            ) : null}
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
