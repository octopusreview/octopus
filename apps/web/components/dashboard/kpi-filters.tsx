"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconUser, IconCalendar } from "@tabler/icons-react";

interface KpiFiltersProps {
  repos: { id: string; name: string }[];
  authors: string[];
  currentRepo: string;
  currentAuthor: string;
  currentPeriod: string;
}

const periodOptions = [
  { value: "7d", label: "This week" },
  { value: "30d", label: "This month" },
  { value: "90d", label: "Last 3 months" },
];

export function KpiFilters({
  repos: _repos,
  authors,
  currentRepo: _currentRepo,
  currentAuthor,
  currentPeriod,
}: KpiFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "all") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const qs = params.toString();
      router.push(qs ? `/dashboard?${qs}` : "/dashboard");
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div>
        <h2 className="text-lg font-semibold">Stats</h2>
        <p className="text-sm text-muted-foreground">Track your team&apos;s review performance over time</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
      <Select
        value={currentAuthor}
        onValueChange={(v) => updateFilter("author", v)}
      >
        <SelectTrigger size="sm" className="h-8 text-xs">
          <IconUser className="mr-1.5 size-3.5 text-muted-foreground" />
          <SelectValue placeholder="All authors" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All authors</SelectItem>
          {authors.map((a) => (
            <SelectItem key={a} value={a}>
              {a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentPeriod}
        onValueChange={(v) => updateFilter("period", v)}
      >
        <SelectTrigger size="sm" className="h-8 text-xs">
          <IconCalendar className="mr-1.5 size-3.5 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {periodOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      </div>
    </div>
  );
}
