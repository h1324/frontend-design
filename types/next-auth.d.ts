// Augment Auth.js types so `role` and `companyId` are first-class on the session, user,
// and JWT — no `any` casts in the auth callbacks.
import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: Role;
    companyId: string;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      companyId: string;
    } & DefaultSession["user"];
  }
}

// JWT lives in @auth/core/jwt; next-auth/jwt only re-exports it, so the augmentation
// must target the source module to merge into the interface.
declare module "@auth/core/jwt" {
  interface JWT {
    role: Role;
    companyId: string;
  }
}
