import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { addFreeCredits, getOrgBalance } from "@/lib/credits";
import { writeAuditLog } from "@/lib/audit";
import { MAX_CREDIT_USD } from "@/lib/incidents";

interface GrantBody {
  org?: unknown;
  amountUsd?: unknown;
  reason?: unknown;
  force?: unknown;
}

/**
 * POST /api/admin/credits/grant — standalone goodwill grant to one org's
 * free-credit balance (the incident flow grants in bulk; this is the manual
 * follow-up / one-off path). `org` accepts a slug or an id.
 */
export async function POST(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: GrantBody;
  try {
    body = (await request.json()) as GrantBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const orgRef = typeof body.org === "string" ? body.org.trim() : "";
  if (!orgRef) {
    return NextResponse.json({ error: "org (slug or id) is required" }, { status: 400 });
  }

  const amountUsd = Number(body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return NextResponse.json({ error: "amountUsd must be a positive number" }, { status: 400 });
  }
  if (amountUsd > MAX_CREDIT_USD && body.force !== true) {
    return NextResponse.json(
      { error: `amountUsd ${amountUsd} exceeds the $${MAX_CREDIT_USD} cap — pass force:true if intentional` },
      { status: 400 },
    );
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const org = await prisma.organization.findFirst({
    where: {
      OR: [{ slug: orgRef }, { id: orgRef }],
      deletedAt: null,
    },
    select: { id: true, slug: true, name: true, bannedAt: true },
  });
  if (!org) {
    return NextResponse.json({ error: `organization "${orgRef}" not found` }, { status: 404 });
  }
  if (org.bannedAt) {
    return NextResponse.json({ error: `organization "${org.slug}" is banned` }, { status: 400 });
  }

  await addFreeCredits(org.id, amountUsd, `Goodwill credit — ${reason}`);

  await writeAuditLog({
    action: "admin.credits.grant",
    category: "admin",
    organizationId: org.id,
    metadata: { amountUsd, reason },
  });

  const balance = await getOrgBalance(org.id);

  return NextResponse.json({
    org: { id: org.id, slug: org.slug, name: org.name },
    granted: amountUsd,
    balance,
  });
}
