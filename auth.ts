import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/db";
import { verifyCredentials } from "@/lib/users";

// Full Node-runtime config: the credentials provider verifies against the DB. The actual
// check (hash comparison, active flag, lastLoginAt stamp) lives in lib/users so it can be
// unit-tested independently of the HTTP layer.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        return verifyCredentials(prisma, email, password);
      },
    }),
  ],
});
