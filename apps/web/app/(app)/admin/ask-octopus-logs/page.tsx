import { prisma } from "@octopus/db";
import { isAdminEmail } from "@/lib/admin";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AskOctopusLogsClient } from "./logs-client";

export default async function AskOctopusLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; flagged?: string; search?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    redirect("/admin");
  }

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 30;
  const flaggedOnly = params.flagged === "true";
  const search = params.search || "";

  const where = {
    ...(flaggedOnly ? { flagged: true } : {}),
    ...(search
      ? {
          OR: [
            { ipAddress: { contains: search } },
            { fingerprint: { contains: search } },
            { messages: { some: { content: { contains: search, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };

  const [sessions, totalCount] = await Promise.all([
    prisma.askOctopusSession.findMany({
      where,
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.askOctopusSession.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ask Octopus Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount} session{totalCount !== 1 ? "s" : ""} total
        </p>
      </div>

      <AskOctopusLogsClient
        sessions={sessions.map((s) => ({
          id: s.id,
          fingerprint: s.fingerprint,
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
          country: s.country,
          flagged: s.flagged,
          flagReason: s.flagReason,
          createdAt: s.createdAt.toISOString(),
          messageCount: s._count.messages,
          messages: s.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt.toISOString(),
          })),
        }))}
        page={page}
        totalPages={totalPages}
        flaggedOnly={flaggedOnly}
        search={search}
      />
    </div>
  );
}
