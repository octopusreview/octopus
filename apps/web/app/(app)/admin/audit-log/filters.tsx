"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AuditLogFilters({
  categories,
  actions,
  currentCategory,
  currentAction,
  currentSearch,
  page,
  totalPages,
  total: _total,
}: {
  categories: string[];
  actions: string[];
  currentCategory?: string;
  currentAction?: string;
  currentSearch?: string;
  page: number;
  totalPages: number;
  total: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Reset to page 1 when filters change (except page itself)
      if (key !== "page") params.delete("page");
      router.push(`/admin/audit-log?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        placeholder="Search by email, action, target..."
        className="h-9 w-64"
        defaultValue={currentSearch ?? ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const value = (e.target as HTMLInputElement).value;
            updateParam("search", value || undefined);
          }
        }}
      />

      <Select
        value={currentCategory ?? "all"}
        onValueChange={(v) => updateParam("category", v === "all" ? undefined : v)}
      >
        <SelectTrigger className="h-9 w-40">
          <SelectValue placeholder="All categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={currentAction ?? "all"}
        onValueChange={(v) => updateParam("action", v === "all" ? undefined : v)}
      >
        <SelectTrigger className="h-9 w-52">
          <SelectValue placeholder="All actions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All actions</SelectItem>
          {actions.map((a) => (
            <SelectItem key={a} value={a}>
              {a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(currentCategory || currentAction || currentSearch) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => router.push("/admin/audit-log")}
        >
          Clear filters
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page <= 1}
          onClick={() => updateParam("page", String(page - 1))}
        >
          Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page >= totalPages}
          onClick={() => updateParam("page", String(page + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
