import "server-only";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import { googleProvider } from "./google";
import { ollamaProvider } from "./ollama";
import { localProvider } from "./local";
import { grokProvider } from "./grok";
import { openrouterProvider } from "./openrouter";
import { alibabaProvider } from "./alibaba";
import { acpProvider } from "./acp";
import { opencodeProvider } from "./opencode";
import { claudeCodeProvider } from "./claude-code";
import { mockProvider } from "./mock";
import { mockFailProvider } from "./mock-fail";
import type { ThinkingEffort } from "./thinking";

export type AiProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "ollama"
  | "local"
  | "grok"
  | "openrouter"
  | "alibaba"
  | "acp"
  | "opencode"
  | "claude-code"
  | "mock"
  | "mock-fail";

export type AiMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * JSON Schema describing the expected response shape. When supplied, providers
 * that support structured-output APIs will use them natively; others append the
 * schema to the system prompt as a fallback. Generate via `providerJsonSchema`
 * in `lib/schemas/json-schema.ts` to ensure provider-unsupported keywords are
 * stripped.
 */
export type ResponseJsonSchema = {
  name: string;
  schema: Record<string, unknown>;
};

export type AiCreateParams = {
  model: string;
  /** Internal complete-input admission; never serialized into provider payloads. */
  completeReviewAdmission?: import("../review-capacity").CompleteReviewAdmission;
  /** Shares the queue lifetime with supplemental recovery after an admitted primary. */
  executionWindow?: import("../review-capacity").ReviewExecutionWindow;
  /** Digest-only observation of the final adapter request; never sent to the model. */
  onRequest?: (receipt: import("./request-evidence").AiRequestReceipt) => void;
  /** Review generation sets 0 so one application attempt is exactly one provider request. */
  maxRetries?: 0;
  signal?: AbortSignal;
  maxTokens: number;
  system?: string;
  messages: AiMessage[];
  cacheSystem?: boolean;
  responseSchema?: ResponseJsonSchema;
  /**
   * Thinking-model reasoning effort, resolved per-org (org override → platform
   * default) by the router. Only affects always-thinking models; others ignore
   * it. Falls back to the env/built-in default when unset.
   */
  effort?: ThinkingEffort;
  /**
   * Set to "disabled" for short utility calls (classification, metadata,
   * validation JSON) so models that default to adaptive thinking (Sonnet 5,
   * Opus 4.7+) don't spend the small max_tokens budget on thinking. Ignored on
   * always-thinking models, which reject thinking-off; Sonnet 5.5 maps it to
   * between_tools to skip upfront thinking instead.
   */
  thinking?: "disabled";
};

export type AiResponse = {
  usedOwnKey?: boolean;
  completion?: { state: "completed" | "incomplete" | "unknown"; reason: string | null };
  text: string;
  provider: AiProvider;
  model: string;
  usage: {
    /** Provider-native: Anthropic uncached input; OpenAI-compatible total input. */
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
};

export type Provider = {
  name: AiProvider;
  /** Whether this provider's API can enforce a JSON schema natively. */
  supportsJsonSchema: boolean;
  /**
   * `apiKey` is the org's BYOK for providers that take one. `orgId` is the
   * calling organisation — needed for per-org config (ollama baseUrl
   * override, local agent dispatch) and OpenAI cache scoping. Forward it
   * even when the provider only makes HTTP calls.
   */
  create(
    params: AiCreateParams,
    apiKey?: string | null,
    orgId?: string | null,
  ): Promise<AiResponse>;
};

/**
 * Test doubles must NEVER be reachable in production — a canned all-clean
 * response from `mock` would silently approve a PR with real vulnerabilities.
 * Gate registration on env: only register in non-prod, or when an operator
 * has explicitly opted in via ENABLE_MOCK_PROVIDERS=true (used for staging
 * smoke tests). `resolveProvider()` already rejects unknown providers so
 * unregistered names cannot be selected.
 */
const mockProvidersAllowed =
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_MOCK_PROVIDERS === "true";

const PROVIDERS: Partial<Record<AiProvider, Provider>> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: googleProvider,
  ollama: ollamaProvider,
  local: localProvider,
  grok: grokProvider,
  openrouter: openrouterProvider,
  alibaba: alibabaProvider,
  acp: acpProvider,
  opencode: opencodeProvider,
  "claude-code": claudeCodeProvider,
  ...(mockProvidersAllowed
    ? { mock: mockProvider, "mock-fail": mockFailProvider }
    : {}),
};

export function getProvider(name: AiProvider): Provider {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Provider "${name}" is not registered in this environment. ` +
        `Mock providers require NODE_ENV!=="production" or ENABLE_MOCK_PROVIDERS="true".`,
    );
  }
  return provider;
}
