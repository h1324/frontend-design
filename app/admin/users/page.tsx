import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor, requireAccess } from "@/lib/rbac";
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
import { createUserAction, setRoleAction, setActiveAction } from "./actions";

const ROLES = [
  "ADMIN",
  "PRODUCTION",
  "STORES",
  "SALES",
  "DISPATCH",
  "ACCOUNTS",
  "VIEWER",
] as const;

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function UsersAdminPage() {
  // Middleware already gates /admin to ADMIN; re-check server-side (defense in depth).
  const actor = requireActor(await auth());
  requireAccess(actor, "USER_ADMIN", "read");

  const users = await prisma.user.findMany({
    where: { companyId: actor.companyId },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-medium text-muted-foreground">EPE Foam ERP · Admin</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Users</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add user</CardTitle>
          <CardDescription>
            Set a temporary password; the user can change it later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createUserAction} className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Temporary password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role">Role</Label>
              <select id="role" name="role" defaultValue="VIEWER" className={selectClass}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Create user</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All users</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{u.name}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{u.email}</td>
                  <td className="py-2 pr-4">
                    <form action={setRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <select name="role" defaultValue={u.role} className={selectClass}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="outline" size="sm">
                        Save
                      </Button>
                    </form>
                  </td>
                  <td className="py-2 pr-4">
                    {u.isActive ? (
                      <span className="text-foreground">Active</span>
                    ) : (
                      <span className="text-muted-foreground">Inactive</span>
                    )}
                  </td>
                  <td className="py-2">
                    <form action={setActiveAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input
                        type="hidden"
                        name="isActive"
                        value={u.isActive ? "false" : "true"}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {u.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
