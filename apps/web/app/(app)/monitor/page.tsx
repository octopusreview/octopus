import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "@/components/link";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { getOrgEntitlements } from "@/lib/entitlements";
import { MonitorClient } from "./monitor-client";

/**
 * /monitor — the per-org live-activity dashboard. Owner/admin only. Shows a live
 * roster (online members + agents) and an activity feed. Free orgs see an
 * upgrade upsell; paid-but-disabled orgs see a prompt to enable it in settings.
 */
export default async function MonitorPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;
  // Require an explicit active org so the page gates the SAME org the polling
  // APIs (/api/presence, /api/activity) resolve from the cookie.
  if (!currentOrgId) redirect("/dashboard");

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      organizationId: currentOrgId,
      deletedAt: null,
    },
    select: { role: true, organizationId: true },
  });
  if (!member) redirect("/dashboard");
  if (member.role !== "owner" && member.role !== "admin") redirect("/settings");

  const orgId = member.organizationId;
  const ent = await getOrgEntitlements(orgId);

  if (!ent.paid) {
    return (
      <Shell>
        <LockedCard
          title="Live Activity is a paid feature"
          body="See who on your team is active and what they're doing in real time. Upgrade your plan to unlock the live monitor."
          cta={{ href: "/settings/billing", label: "Upgrade plan" }}
        />
      </Shell>
    );
  }

  if (!ent.liveTelemetryActive) {
    return (
      <Shell>
        <LockedCard
          title="Live Activity is off"
          body="Turn on live activity monitoring for your organization to see who's online and what they're doing here."
          cta={{ href: "/settings/telemetry", label: "Enable in settings" }}
        />
      </Shell>
    );
  }

  const initialEvents = await prisma.activityEvent.findMany({
    where: { organizationId: orgId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });

  return (
    <Shell>
      <MonitorClient
        orgId={orgId}
        pubbyEnabled={!!process.env.NEXT_PUBLIC_PUBBY_KEY}
        initialEvents={initialEvents.map((e) => ({
          id: e.id,
          action: e.action,
          target: e.target,
          actorType: e.actorType,
          actorId: e.actorId,
          actorLabel: e.actorLabel,
          createdAt: e.createdAt.toISOString(),
        }))}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
      <div>
        <h1 className="text-xl font-semibold">Live Activity</h1>
        <p className="text-sm text-muted-foreground">
          Who&apos;s online and what&apos;s happening in your organization right now.
        </p>
      </div>
      {children}
    </div>
  );
}

function LockedCard({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
      <Link
        href={cta.href}
        className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        {cta.label}
      </Link>
    </div>
  );
}
