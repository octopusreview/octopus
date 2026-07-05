"use server";

import { prisma } from "@octopus/db";
import { revalidatePath } from "next/cache";
import { getSuperAdmin } from "@/lib/superadmin";
import { generateServiceToken, hashToken, serviceTokenPrefix } from "@/lib/api-auth";
import { normalizeScopes } from "@/lib/scopes";

// Super-admin is re-checked inside EVERY action (defense in depth — the page
// gate alone is not sufficient for state-changing operations).

export async function createServiceToken(
  formData: FormData,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const sa = await getSuperAdmin();
  if (!sa) return { ok: false, error: "Forbidden" };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "A name is required" };

  const selected = formData.getAll("scopes").map((s) => String(s));
  let scopes: string[];
  try {
    scopes = normalizeScopes(selected);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const token = generateServiceToken();
  await prisma.serviceToken.create({
    data: {
      name,
      tokenHash: hashToken(token),
      tokenPrefix: serviceTokenPrefix(token),
      scopes,
      createdBy: sa.id,
    },
  });

  revalidatePath("/admin/tokens");
  // The plaintext token is returned ONCE for display and never persisted/logged.
  return { ok: true, token };
}

export async function revokeServiceToken(id: string): Promise<{ ok: boolean }> {
  const sa = await getSuperAdmin();
  if (!sa) return { ok: false };
  await prisma.serviceToken.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/admin/tokens");
  return { ok: true };
}
