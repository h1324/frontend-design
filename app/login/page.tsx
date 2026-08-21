import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STATES = [
  { label: "Curing", color: "hsl(33 92% 52%)" },
  { label: "Available", color: "hsl(168 60% 46%)" },
  { label: "Allocated", color: "hsl(224 66% 66%)" },
  { label: "Dispatched", color: "hsl(202 16% 62%)" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/",
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/login?error=CredentialsSignin");
      }
      throw err;
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-foreground px-8 py-10 text-background lg:px-14 lg:py-14">
        {/* ambient closed-cell texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "radial-gradient(hsl(168 64% 60%) 1.5px, transparent 1.6px)",
            backgroundSize: "22px 22px",
          }}
          aria-hidden
        />
        <div className="relative flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand">
            <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden fill="none">
              {[0, 6.5, 13].map((y) =>
                [0, 6.5, 13].map((x) => (
                  <rect
                    key={`${x}-${y}`}
                    x={x}
                    y={y}
                    width="5"
                    height="5"
                    rx="1.4"
                    fill="hsl(197 40% 8%)"
                    opacity={(x + y) % 13 === 0 ? 1 : 0.55}
                  />
                )),
              )}
            </svg>
          </span>
          <span className="font-display text-base font-extrabold tracking-tight">
            EPE FOAM
          </span>
        </div>

        <div className="relative max-w-md">
          <p
            className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.16em]"
            style={{ color: "hsl(168 56% 60%)" }}
          >
            Operations system
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold leading-[1.1] tracking-tight lg:text-4xl">
            Every roll, from the die to the invoice.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-background/70">
            Roll-level traceability, kg ↔ m² that always reconciles, and curing-aware
            stock — the things Tally can&apos;t do. The statutory books stay in Tally.
          </p>
          {/* state-as-temperature legend — the app's visual language, previewed */}
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2">
            {STATES.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                <span className="text-background/40">{i > 0 ? "→" : ""}</span>
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="text-xs text-background/80">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative font-mono text-xs text-background/40">
          On-premise · works when the line loses its link
        </p>
      </section>

      {/* Sign-in */}
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl font-bold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your plant account to continue.
          </p>
          <form action={login} className="mt-8 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>
            {error ? (
              <p className="rounded-md bg-state-rejected-soft px-3 py-2 text-sm text-state-rejected">
                That email and password don&apos;t match. Try again.
              </p>
            ) : null}
            <Button type="submit" className="mt-2 h-11">
              Sign in
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
