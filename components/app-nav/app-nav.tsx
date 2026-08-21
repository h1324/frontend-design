"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { NAV_GROUPS } from "./nav-data";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppNav({
  userName,
  role,
  signOutAction,
}: {
  userName: string;
  role: string;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const groups = NAV_GROUPS.filter((g) => !g.adminOnly || role === "ADMIN");

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      <Link
        href="/"
        onClick={() => setOpen(false)}
        className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          pathname === "/"
            ? "bg-accent text-accent-foreground"
            : "text-foreground hover:bg-secondary"
        }`}
      >
        Console
      </Link>
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 px-3 pb-1">
            <span
              className="h-2 w-2 rounded-[3px]"
              style={{ backgroundColor: group.accent }}
              aria-hidden
            />
            <span className="eyebrow">{group.title}</span>
          </div>
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`relative rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {active ? (
                  <span
                    className="absolute inset-y-1.5 left-0 w-0.5 rounded-full"
                    style={{ backgroundColor: group.accent }}
                    aria-hidden
                  />
                ) : null}
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-border px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{userName}</p>
          <p className="eyebrow">{role}</p>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            aria-label="Sign out"
            className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-border bg-card lg:flex">
        <div className="border-b border-border px-4 py-4">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
        {nav}
        {footer}
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <Link href="/">
          <Wordmark />
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="grid h-9 w-9 place-items-center rounded-md border border-border text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="absolute inset-0 bg-foreground/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85%] flex-col bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <Wordmark />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid h-8 w-8 place-items-center rounded-md border border-border text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      ) : null}
    </>
  );
}
