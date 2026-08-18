import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AppNav } from "@/components/app-nav/app-nav";
import { signOutAction } from "./actions";

// The authenticated shell: a persistent sidebar (desktop) / drawer (mobile) wraps every module
// page. Login and the field-orders PWA (/m) live outside this group and stay full-bleed.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return (
    <div className="min-h-screen">
      <AppNav
        userName={session?.user?.name ?? "—"}
        role={session?.user?.role ?? "VIEWER"}
        signOutAction={signOutAction}
      />
      <div className="lg:pl-[248px]">{children}</div>
    </div>
  );
}
