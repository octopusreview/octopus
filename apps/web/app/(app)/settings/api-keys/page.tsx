import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { decryptStringMaybeLegacy } from "@/lib/crypto";
import { ApiKeysForm } from "../api-keys-form";

// Decrypt the stored key (ciphertext at rest) and return a masked preview so the
// full plaintext key never reaches the browser.
function maskStoredKey(stored: string | null): string | null {
  if (!stored) return null;
  const key = decryptStringMaybeLegacy(stored);
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 7) + "••••••••" + key.slice(-4);
}

export default async function ApiKeysPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: {
      role: true,
      organization: {
        select: {
          id: true,
          openaiApiKey: true,
          anthropicApiKey: true,
          googleApiKey: true,
          cohereApiKey: true,
        },
      },
    },
  });

  if (!member) redirect("/dashboard");

  const canManage = member.role === "owner" || member.role === "admin";

  return (
    <ApiKeysForm
      key={member.organization.id}
      openaiApiKey={maskStoredKey(member.organization.openaiApiKey)}
      anthropicApiKey={maskStoredKey(member.organization.anthropicApiKey)}
      googleApiKey={maskStoredKey(member.organization.googleApiKey)}
      cohereApiKey={maskStoredKey(member.organization.cohereApiKey)}
      isOwner={canManage}
    />
  );
}
