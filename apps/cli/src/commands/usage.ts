import { loadCredentials } from "../lib/credentials.js";
import { getJson } from "../lib/api.js";
import { hasFlag } from "../lib/args.js";
import { c, error, info, heading, table, sanitizeTerminal } from "../lib/output.js";
import type { UsageBreakdown } from "../lib/types.js";

type UsageResponse = {
  period: { start: string; end: string };
  totalSpend: number;
  spendLimit: number | null;
  creditBalance: number;
  freeCreditBalance: number;
  breakdown: UsageBreakdown[];
};

function usd(n: number): string {
  const decimals = n > 0 && n < 0.01 ? 4 : 2;
  return `$${n.toFixed(decimals)}`;
}

function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** `octp usage` — show monthly spend, credit balances, and a per-model breakdown. */
export async function usageCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    console.log("octp usage — show monthly usage, credit balance, and a per-model cost breakdown");
    return 0;
  }

  const creds = await loadCredentials();
  if (!creds) {
    error("Not signed in. Run `octp login`.");
    return 2;
  }

  const res = await getJson<UsageResponse>(`${creds.baseUrl}/api/cli/usage`, {
    headers: { authorization: `Bearer ${creds.token}` },
  });
  if (!res.ok) {
    if (res.status === 401) {
      error("Session expired or token revoked. Run `octp login` again.");
      return 1;
    }
    error(`Could not fetch usage (HTTP ${res.status}: ${res.error})`);
    return 1;
  }

  const data = res.data;

  heading("Monthly Usage");
  info(`  Period:         ${new Date(data.period.start).toLocaleDateString()} — now`);
  info(`  Total Spend:    ${c.bold(usd(data.totalSpend))}`);
  if (data.spendLimit !== null) {
    info(`  Spend Limit:    ${usd(data.spendLimit)}`);
  }
  info(`  Credit Balance: ${usd(data.creditBalance)} (+ ${usd(data.freeCreditBalance)} free)`);

  if (data.breakdown.length > 0) {
    heading("Breakdown");
    const rows = [...data.breakdown]
      .sort((a, b) => b.cost - a.cost)
      .map((row) => [
        sanitizeTerminal(row.model),
        sanitizeTerminal(row.operation),
        num(row.count),
        num(row.inputTokens),
        num(row.outputTokens),
        usd(row.cost),
      ]);
    table(rows, ["Model", "Operation", "Calls", "Input", "Output", "Cost"]);
    console.log();
  }

  return 0;
}
