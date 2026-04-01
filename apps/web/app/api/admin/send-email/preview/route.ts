import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@octopus/db";
import { headers } from "next/headers";
import { buildAudienceWhere } from "../audience";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const audience = searchParams.get("audience") || "all";
  const slug = searchParams.get("slug") || undefined;
  const cooldown = Number(searchParams.get("cooldownDays")) || 30;

  const where = buildAudienceWhere(audience);

  // If a template is selected, exclude users who received it within cooldown
  const cooldownDate = new Date(Date.now() - cooldown * 24 * 60 * 60 * 1000);
  const recipients = await prisma.user.findMany({
    where: {
      ...where,
      ...(slug
        ? { emailSends: { none: { slug, sentAt: { gte: cooldownDate } } } }
        : {}),
    },
    select: { id: true, email: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });

  return NextResponse.json({ recipients, total: recipients.length });
}
