import "server-only";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import { googleProvider } from "./google";
import { grokProvider } from "./grok";
import { openrouterProvider } from "./openrouter";
import { ollamaProvider } from "./ollama";
import { acpProvider } from "./acp";
import { opencodeProvider } from "./opencode";

export type AiProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "grok"
  | "openrouter"
  | "ollama"
  | "acp"
  | "opencode";

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
  maxTokens: number;
  system?: string;
  messages: AiMessage[];
  cacheSystem?: boolean;
  responseSchema?: ResponseJsonSchema;
};

export type AiResponse = {
  text: string;
  provider: AiProvider;
  model: string;
  usage: {
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
  create(params: AiCreateParams, apiKey?: string | null): Promise<AiResponse>;
};

const PROVIDERS: Record<AiProvider, Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: googleProvider,
  grok: grokProvider,
  openrouter: openrouterProvider,
  ollama: ollamaProvider,
  acp: acpProvider,
  opencode: opencodeProvider,
};

export function getProvider(name: AiProvider): Provider {
  return PROVIDERS[name];
}
