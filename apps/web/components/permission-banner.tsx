"use client";

import { IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";

type Org = { id: string; name: string };

export function PermissionBanner({ orgs }: { orgs: Org[] }) {
  if (orgs.length === 0) return null;

  const orgNames = orgs.map((o) => o.name).join(", ");

  return (
    <div className="sticky top-0 z-50">
      <div className="flex items-center justify-between gap-3 bg-red-950 px-4 py-1.5">
        <div className="flex items-center gap-2 overflow-hidden">
          <IconAlertTriangle className="size-3.5 shrink-0 text-red-400" />
          <p className="truncate text-xs text-red-200">
            <span className="font-medium">Permissions required:</span>{" "}
            {orgNames}
            <span className="text-red-200/50">
              {" "}&mdash; disappears after next successful review
            </span>
          </p>
        </div>
        <a
          href="/api/github/install?returnTo=/dashboard"
          className="inline-flex shrink-0 items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 text-[11px] font-medium text-red-200 transition-colors hover:bg-red-500/30"
        >
          Grant
          <IconExternalLink className="size-2.5" />
        </a>
      </div>
    </div>
  );
}
