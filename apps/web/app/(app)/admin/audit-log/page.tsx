import { prisma } from "@octopus/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AuditLogFilters } from "./filters";

const PAGE_SIZE = 50;

const categoryColors: Record<string, string> = {
  auth: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  email: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  review: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  repo: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  knowledge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300",
  billing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  admin: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  system: "bg-stone-100 text-stone-800 dark:bg-stone-900 dark:text-stone-300",
};

function formatAction(action: string): string {
  return action
    .replace(/\./g, " > ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMetadata(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined || value === "") continue;
    const label = key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim();
    parts.push(`${label}: ${String(value)}`);
  }
  return parts.join(" | ");
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const category = typeof params.category === "string" ? params.category : undefined;
  const action = typeof params.action === "string" ? params.action : undefined;
  const search = typeof params.search === "string" ? params.search : undefined;

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (action) where.action = { contains: action, mode: "insensitive" };
  if (search) {
    where.OR = [
      { actorEmail: { contains: search, mode: "insensitive" } },
      { action: { contains: search, mode: "insensitive" } },
      { targetId: { contains: search, mode: "insensitive" } },
    ];
  }

  const [logs, total, categories, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <AuditLogFilters
        categories={categories.map((c) => c.category)}
        actions={actions.map((a) => a.action)}
        currentCategory={category}
        currentAction={action}
        currentSearch={search}
        page={page}
        totalPages={totalPages}
        total={total}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Audit Log</span>
            <span className="text-sm font-normal text-muted-foreground">
              {total.toLocaleString()} event{total !== 1 ? "s" : ""}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No audit log entries found.
            </p>
          ) : (
            <div className="space-y-0 divide-y">
              {logs.map((log) => {
                const meta = (log.metadata ?? {}) as Record<string, unknown>;
                const metaStr = formatMetadata(meta);

                return (
                  <div key={log.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start gap-2">
                      <Badge
                        variant="secondary"
                        className={`shrink-0 text-[10px] font-semibold uppercase ${categoryColors[log.category] ?? ""}`}
                      >
                        {log.category}
                      </Badge>
                      <span className="text-sm font-medium">
                        {formatAction(log.action)}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {log.createdAt.toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {log.actorEmail && (
                        <span>
                          by <span className="font-medium text-foreground">{log.actorEmail}</span>
                        </span>
                      )}
                      {log.targetType && (
                        <span>
                          target: {log.targetType}
                          {log.targetId ? ` (${log.targetId.slice(0, 12)}...)` : ""}
                        </span>
                      )}
                      {log.ipAddress && <span>IP: {log.ipAddress}</span>}
                    </div>

                    {metaStr && (
                      <p className="mt-1 truncate text-xs text-muted-foreground/70">
                        {metaStr}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
