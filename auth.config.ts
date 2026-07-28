import type { NextAuthConfig } from "next-auth";

// Edge-safe config: no bcrypt, no Prisma, no Node-only imports. Used by middleware and
// spread into the full Node config in auth.ts. Keeping these apart is what lets the
// credentials provider (which needs bcrypt + Prisma) stay out of the edge runtime.
export const authConfig = {
  // Self-hosted on the plant mini-PC (brief §4), not behind Vercel's host detection, so
  // the runtime host is trusted explicitly. Otherwise Auth.js rejects every /api/auth
  // request with UntrustedHost.
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    // Runs in middleware: allow the login page, protect everything else.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin = nextUrl.pathname.startsWith("/login");
      if (isOnLogin) return true;
      return isLoggedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.companyId = user.companyId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.companyId = token.companyId;
      }
      return session;
    },
  },
  providers: [], // real providers are added in auth.ts (Node runtime)
} satisfies NextAuthConfig;
