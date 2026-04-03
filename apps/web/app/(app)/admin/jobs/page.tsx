import { prisma } from "@octopus/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueueConfigManager } from "../queue-config-manager";
import { getQueueConfig } from "../model-actions";

type PgBossJob = {
  id: string;
  name: string;
  state: string;
  data: Record<string, unknown>;
  createdon: Date;
  startedon: Date | null;
  completedon: Date | null;
  retrycount: number;
  output: Record<string, unknown> | null;
};

const stateColors: Record<string, string> = {
  created: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  active: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  expired: "bg-stone-100 text-stone-800 dark:bg-stone-900 dark:text-stone-300",
  cancelled: "bg-stone-100 text-stone-800 dark:bg-stone-900 dark:text-stone-300",
};

const PAGE_SIZE = 50;

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const stateFilter = typeof params.state === "string" ? params.state : undefined;
  const nameFilter = typeof params.name === "string" ? params.name : undefined;
  const page = Math.max(1, parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const queueConfig = await getQueueConfig();

  // Check if pgboss schema exists (created on first boss.start())
  const schemaExists = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss') as exists`,
  );

  if (!schemaExists[0]?.exists) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground text-sm">
              pg-boss hasn&apos;t been initialized yet. Jobs will appear here after the first
              application start with the queue enabled.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Query pg-boss tables directly
  const whereClause = [
    stateFilter ? `state = '${stateFilter}'` : null,
    nameFilter ? `name = '${nameFilter}'` : null,
  ]
    .filter(Boolean)
    .join(" AND ");

  const totalResult = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) as count FROM pgboss.job ${whereClause ? `WHERE ${whereClause}` : ""}`,
  );
  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const jobs = await prisma.$queryRawUnsafe<PgBossJob[]>(
    `SELECT id, name, state, data, created_on as createdon, started_on as startedon, completed_on as completedon, retry_count as retrycount, output
     FROM pgboss.job
     ${whereClause ? `WHERE ${whereClause}` : ""}
     ORDER BY created_on DESC
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
  );

  const stats = await prisma.$queryRawUnsafe<
    { state: string; count: bigint }[]
  >(
    `SELECT state, COUNT(*) as count FROM pgboss.job GROUP BY state ORDER BY state`,
  );

  const jobNames = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT DISTINCT name FROM pgboss.job ORDER BY name`,
  );

  return (
    <div className="space-y-4">
      {/* Queue Configuration */}
      <QueueConfigManager initialConfig={queueConfig} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.state}>
            <CardContent className="p-4">
              <p className="text-muted-foreground text-xs font-medium uppercase">
                {s.state}
              </p>
              <p className="text-2xl font-bold">{Number(s.count)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <a
          href="/admin/jobs"
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${!stateFilter ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
        >
          All
        </a>
        {["created", "retry", "active", "completed", "cancelled", "failed"].map((s) => (
          <a
            key={s}
            href={`/admin/jobs?state=${s}${nameFilter ? `&name=${nameFilter}` : ""}`}
            className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${stateFilter === s ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            {s}
          </a>
        ))}
        {jobNames.length > 1 && (
          <>
            <span className="text-muted-foreground self-center text-xs">|</span>
            {jobNames.map((j) => (
              <a
                key={j.name}
                href={`/admin/jobs?name=${j.name}${stateFilter ? `&state=${stateFilter}` : ""}`}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${nameFilter === j.name ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
              >
                {j.name}
              </a>
            ))}
          </>
        )}
      </div>

      {/* Jobs list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Jobs</span>
            <span className="text-muted-foreground text-sm font-normal">
              {totalCount} total &middot; Page {page} of {totalPages}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No jobs found. Jobs will appear here when pg-boss processes them.
            </p>
          ) : (
            <div className="divide-y space-y-0">
              {jobs.map((job) => {
                const data = job.data as Record<string, unknown>;
                return (
                  <div key={job.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start gap-2">
                      <Badge
                        variant="secondary"
                        className={`shrink-0 text-[10px] font-semibold uppercase ${stateColors[job.state] ?? ""}`}
                      >
                        {job.state}
                      </Badge>
                      <span className="text-sm font-medium">{job.name}</span>
                      {job.retrycount > 0 && (
                        <span className="text-muted-foreground text-xs">
                          retry #{job.retrycount}
                        </span>
                      )}
                      <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                        {new Date(job.createdon).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>

                    <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {"email" in data && (
                        <span>
                          to:{" "}
                          <span className="text-foreground font-medium">
                            {String(data.email)}
                          </span>
                        </span>
                      )}
                      {job.startedon && (
                        <span>
                          started:{" "}
                          {new Date(job.startedon).toLocaleTimeString()}
                        </span>
                      )}
                      {job.completedon && (
                        <span>
                          completed:{" "}
                          {new Date(job.completedon).toLocaleTimeString()}
                        </span>
                      )}
                    </div>

                    {job.state === "failed" && job.output && (
                      <p className="mt-1 truncate text-xs text-red-500">
                        {JSON.stringify(job.output)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t pt-4 mt-4">
              <a
                href={`/admin/jobs?page=${page - 1}${stateFilter ? `&state=${stateFilter}` : ""}${nameFilter ? `&name=${nameFilter}` : ""}`}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${page <= 1 ? "pointer-events-none text-muted-foreground/40" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                aria-disabled={page <= 1}
              >
                &larr; Previous
              </a>
              <span className="text-muted-foreground text-xs">
                Page {page} of {totalPages}
              </span>
              <a
                href={`/admin/jobs?page=${page + 1}${stateFilter ? `&state=${stateFilter}` : ""}${nameFilter ? `&name=${nameFilter}` : ""}`}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${page >= totalPages ? "pointer-events-none text-muted-foreground/40" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                aria-disabled={page >= totalPages}
              >
                Next &rarr;
              </a>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
