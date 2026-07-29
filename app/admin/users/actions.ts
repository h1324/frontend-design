"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/rbac";
import { createUser, setUserRole, setUserActive } from "@/lib/users";

// Thin HTTP wrappers over lib/users. Authorization is enforced inside those functions
// (requireAccess USER_ADMIN) as well as by the /admin middleware gate — defense in depth.

async function currentActor() {
  return requireActor(await auth());
}

export async function createUserAction(formData: FormData) {
  const actor = await currentActor();
  await prisma.$transaction((tx) =>
    createUser(tx, actor, {
      email: String(formData.get("email") ?? ""),
      name: String(formData.get("name") ?? ""),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? "VIEWER") as Role,
    }),
  );
  revalidatePath("/admin/users");
}

export async function setRoleAction(formData: FormData) {
  const actor = await currentActor();
  await prisma.$transaction((tx) =>
    setUserRole(
      tx,
      actor,
      String(formData.get("userId")),
      String(formData.get("role")) as Role,
    ),
  );
  revalidatePath("/admin/users");
}

export async function setActiveAction(formData: FormData) {
  const actor = await currentActor();
  await prisma.$transaction((tx) =>
    setUserActive(
      tx,
      actor,
      String(formData.get("userId")),
      formData.get("isActive") === "true",
    ),
  );
  revalidatePath("/admin/users");
}
