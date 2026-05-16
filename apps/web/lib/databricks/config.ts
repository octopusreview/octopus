import "server-only";

/**
 * Strongly-typed accessor for Databricks-related environment variables.
 *
 * The Databricks App platform injects these automatically (DATABRICKS_HOST,
 * DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, and the *_SERVING_ENDPOINT
 * names resolved from the app.yaml resources block). For local dev, you can
 * point at your personal workspace by exporting the same vars.
 */

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. ` +
        `On Databricks Apps this is injected by the platform; locally, export it before running.`,
    );
  }
  return v;
}

function envOrDefault(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  /** Workspace URL with `https://` prefix and no trailing slash. Apps inject without scheme. */
  get host(): string {
    let h = envOrThrow("DATABRICKS_HOST").trim().replace(/\/$/, "");
    if (!/^https?:\/\//i.test(h)) h = `https://${h}`;
    return h;
  },

  /** App SP client id (injected by Databricks Apps runtime) */
  get clientId(): string {
    return envOrThrow("DATABRICKS_CLIENT_ID");
  },

  /** App SP client secret (injected by Databricks Apps runtime) */
  get clientSecret(): string {
    return envOrThrow("DATABRICKS_CLIENT_SECRET");
  },

  /** Model Serving endpoint names (resolved from app.yaml resources) */
  get anthropicEndpoint(): string {
    return envOrDefault("ANTHROPIC_SERVING_ENDPOINT", "octopus-claude");
  },
  get openaiEndpoint(): string {
    return envOrDefault("OPENAI_SERVING_ENDPOINT", "octopus-openai");
  },
  get geminiEndpoint(): string {
    return envOrDefault("GEMINI_SERVING_ENDPOINT", "octopus-gemini");
  },
  get embeddingsEndpoint(): string {
    return envOrDefault("OPENAI_EMBEDDINGS_SERVING_ENDPOINT", "octopus-openai-embeddings");
  },

  /** Vector Search endpoint + index location */
  get vsEndpoint(): string {
    return envOrDefault("VECTOR_SEARCH_ENDPOINT", "octopus-vs");
  },
  get vsCatalog(): string {
    return envOrDefault("VECTOR_SEARCH_CATALOG", "octopus_ai_catalog");
  },
  get vsSchema(): string {
    return envOrDefault("VECTOR_SEARCH_SCHEMA", "vectors");
  },

  /** Lakebase Autoscale instance for password vending (`databricks postgres generate-credential`) */
  get lakebaseProject(): string {
    return envOrDefault("LAKEBASE_PROJECT", "octopus-app");
  },
  get lakebaseBranch(): string {
    return envOrDefault("LAKEBASE_BRANCH", "production");
  },
  get lakebaseEndpoint(): string {
    return envOrDefault("LAKEBASE_ENDPOINT", "ep-primary");
  },

  /** True when running inside a Databricks App container */
  get isDatabricksRuntime(): boolean {
    return Boolean(process.env.DATABRICKS_HOST && process.env.DATABRICKS_CLIENT_ID);
  },
};

/** Full index name: `catalog.schema.collection` */
export function vsIndexName(collection: string): string {
  return `${config.vsCatalog}.${config.vsSchema}.${collection}`;
}
