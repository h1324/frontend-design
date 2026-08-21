import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Gate every route through the edge-safe config's `authorized` callback.
export default NextAuth(authConfig).auth;

export const config = {
  // Skip Next internals, the auth API routes, and the public PWA assets (manifest, service
  // worker, icon — spec S27) so installability and SW registration are never redirected to
  // login; protect everything else.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon.svg).*)",
  ],
};
