import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Gate every route through the edge-safe config's `authorized` callback.
export default NextAuth(authConfig).auth;

export const config = {
  // Skip Next internals and the auth API routes; protect everything else.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
