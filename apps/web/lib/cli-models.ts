/**
 * Shape of GET /api/cli/models: what the org's reviews run on right now, so the
 * CLI can say "Reviews on Cloud use your org's default model: X". Read-only,
 * booleans only for keys (never key material).
 */
export const ORG_KEY_COLUMNS = {
  anthropic: "anthropicApiKey",
  openai: "openaiApiKey",
  google: "googleApiKey",
  grok: "grokApiKey",
  openrouter: "openrouterApiKey",
  alibaba: "alibabaApiKey",
} as const;

export type OrgKeyColumn = (typeof ORG_KEY_COLUMNS)[keyof typeof ORG_KEY_COLUMNS];

export type CliModelsResponse = {
  provider: string;
  model: string;
  displayName: string | null;
  /** true when no org/repo pin exists and the platform default applies. */
  isPlatformDefault: boolean;
  /** Providers for which the org has its own API key configured. */
  byokProviders: string[];
};

export function byokProvidersFrom(keys: Partial<Record<OrgKeyColumn, string | null>>): string[] {
  return (Object.entries(ORG_KEY_COLUMNS) as [string, OrgKeyColumn][])
    .filter(([, column]) => Boolean(keys[column]))
    .map(([provider]) => provider);
}

export function buildCliModelsResponse(input: {
  model: string;
  pinned: boolean;
  provider: string;
  displayName: string | null;
  keys: Partial<Record<OrgKeyColumn, string | null>>;
}): CliModelsResponse {
  return {
    provider: input.provider,
    model: input.model,
    displayName: input.displayName,
    isPlatformDefault: !input.pinned,
    byokProviders: byokProvidersFrom(input.keys),
  };
}
