"use client";

import Link from "@/components/link";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IconListCheck, IconBrandGithub } from "@tabler/icons-react";

type PrHighlight = {
  label: string;
  url: string;
};

type RepoSummary = {
  name: string;
  prCount: number;
  highlights: PrHighlight[];
};

export function WeeklySummaryCard({
  repos,
}: {
  repos: RepoSummary[];
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <IconListCheck className="size-3.5" />
            What was done in the last week?
          </div>
          <Link
            href="/timeline"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            See all &rarr;
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {repos.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-12">
            <IconListCheck className="mb-2 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No activity this week
            </p>
          </div>
        ) : (
          repos.map((repo) => (
            <div key={repo.name} className="space-y-2">
              <div className="flex items-center gap-2">
                <IconBrandGithub className="size-4 text-muted-foreground" />
                <a
                  href={`https://github.com/${repo.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium hover:text-muted-foreground transition-colors"
                >
                  {repo.name}
                </a>
                <Badge variant="secondary" className="ml-auto text-xs">
                  {repo.prCount} PRs
                </Badge>
              </div>
              <ul className="space-y-1 pl-6">
                {repo.highlights.map((h, i) => (
                  <li
                    key={i}
                    className="list-disc text-sm text-muted-foreground"
                  >
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-foreground transition-colors"
                    >
                      {h.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
