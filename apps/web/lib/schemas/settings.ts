import { z } from "zod";

// Client-side mirrors of the validation in app/(app)/actions.ts
// (updateOrganizationName / updateApiKeys). Keep the rules and messages in
// sync with the server — the server remains the source of truth.

export const orgNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters.")
    .max(100, "Organization name must be at most 100 characters.")
    .refine((name) => !/[<>"{}]/.test(name), {
      message: "Organization name contains invalid characters.",
    }),
});

export type OrgNameInput = z.infer<typeof orgNameSchema>;

/**
 * Optional API key: blank keeps the existing key, so empty strings are always
 * valid. When non-empty, the key must start with the provider's prefix.
 */
function optionalApiKey(provider: string, prefix: string) {
  return z
    .string()
    .trim()
    .refine((key) => key === "" || key.startsWith(prefix), {
      message: `Invalid ${provider} API key format.`,
    })
    .optional();
}

export const apiKeysSchema = z.object({
  openaiApiKey: optionalApiKey("OpenAI", "sk-"),
  anthropicApiKey: optionalApiKey("Anthropic", "sk-ant-"),
  googleApiKey: optionalApiKey("Google AI", "AIza"),
  // The server does not check the Cohere key format, so neither do we.
  cohereApiKey: z.string().trim().optional(),
  grokApiKey: optionalApiKey("Grok (xAI)", "xai-"),
  openrouterApiKey: optionalApiKey("OpenRouter", "sk-or-"),
  alibabaApiKey: optionalApiKey("Alibaba Cloud Model Studio", "sk-"),
});

export type ApiKeysInput = z.infer<typeof apiKeysSchema>;
export type ApiKeyField = keyof ApiKeysInput;
