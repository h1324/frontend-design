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
        </CardContent>
      </Card>
    </main>
  );
}
