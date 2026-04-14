"use client";

import Link from "next/link";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { SpendLimitResult } from "@/lib/cost";

export function SpendLimitBanner({ spendStatus }: { spendStatus: SpendLimitResult }) {
  if (!spendStatus.blocked) return null;

  let message: string;
  if (spendStatus.reason === "no_credits") {
    message = "Credit balance is $0.";
  } else if (spendStatus.limitUsd === 0) {
    message = "Monthly AI usage limit is set to $0.";
  } else {
    message = `Monthly AI usage limit reached ($${spendStatus.limitUsd}).`;
  }

  return (
    <div className="sticky top-0 z-50">
      <div className="flex items-center justify-between gap-3 bg-amber-950 px-4 py-1.5">
        <div className="flex items-center gap-2 overflow-hidden">
          <IconAlertTriangle className="size-3.5 shrink-0 text-amber-400" />
          <p className="truncate text-xs text-amber-200">
            <span className="font-medium">{message}</span>{" "}
            Enter your own API keys or purchase credits to continue.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/settings/billing"
            className="inline-flex items-center gap-1 rounded bg-amber-400/90 px-2 py-0.5 text-[11px] font-medium text-amber-950 transition-colors hover:bg-amber-400"
          >
            Purchase Credits
          </Link>
          <Link
            href="/settings/api-keys"
            className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/30"
          >
            API Keys
          </Link>
        </div>
      </div>
    </div>
  );
}
