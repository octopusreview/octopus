export type MonthlySpendSummary = {
  spendUsd: number;
  limitUsd: number | null;
  remainingUsd: number | null;
  percentUsed: number | null;
  progressPercent: number | null;
  limitReached: boolean;
};

export type AutoReloadDisplayStatus = "on" | "paused" | "off";

export function getAutoReloadDisplayStatus(
  enabled: boolean,
  pausedForDurableUpgrade: boolean,
): AutoReloadDisplayStatus {
  if (pausedForDurableUpgrade) return "paused";
  return enabled ? "on" : "off";
}

export function getUtcMonthBounds(now = new Date()): { start: Date; end: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
}

export function formatBillingResetLabel(periodEnd: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(periodEnd);
}

export function summarizeMonthlySpend(
  monthlySpendUsd: number,
  monthlySpendLimitUsd: number | null,
): MonthlySpendSummary {
  const spendUsd = Number.isFinite(monthlySpendUsd)
    ? Math.max(0, monthlySpendUsd)
    : 0;
  const limitUsd =
    monthlySpendLimitUsd != null && Number.isFinite(monthlySpendLimitUsd)
      ? Math.max(0, monthlySpendLimitUsd)
      : null;

  if (limitUsd == null) {
    return {
      spendUsd,
      limitUsd: null,
      remainingUsd: null,
      percentUsed: null,
      progressPercent: null,
      limitReached: false,
    };
  }

  if (limitUsd === 0) {
    return {
      spendUsd,
      limitUsd,
      remainingUsd: 0,
      percentUsed: 100,
      progressPercent: 100,
      limitReached: true,
    };
  }

  const percentUsed = (spendUsd / limitUsd) * 100;

  return {
    spendUsd,
    limitUsd,
    remainingUsd: Math.max(0, limitUsd - spendUsd),
    percentUsed,
    progressPercent: Math.min(100, percentUsed),
    limitReached: spendUsd >= limitUsd,
  };
}
