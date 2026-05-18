import "server-only";
import { prisma } from "@octopus/db";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { callOpenAiGateway } from "./openai-gateway";

/**
 * OpenCode — gateway provider exposing an OpenAI-compatible Chat Completions
 * endpoint. Same shape as ACPX, just different env / column names. Both share
 * the implementation via `callOpenAiGateway`.
 *
 * Per-org config required:
 *   Organization.opencodeBaseUrl
 *   Organization.opencodeApiKey
 *
 * Self-hosters can also set OPENCODE_BASE_URL + OPENCODE_API_KEY env vars.
 *
 * Model IDs are namespaced — `opencode:gpt-4o`, `opencode:…`, etc.
 */

async function resolveConfig(orgId?: string | null): Promise<{ baseUrl: string; apiKey: string } | null> {
  const envBase = process.env.OPENCODE_BASE_URL;
  const envKey = process.env.OPENCODE_API_KEY;
  if (envBase && envKey) return { baseUrl: envBase, apiKey: envKey };

  if (!orgId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { opencodeBaseUrl: true, opencodeApiKey: true },
  });
  if (org?.opencodeBaseUrl && org?.opencodeApiKey) {
    return { baseUrl: org.opencodeBaseUrl, apiKey: org.opencodeApiKey };
  }
  return null;
}

export const opencodeProvider: Provider = {
  name: "opencode",
  supportsJsonSchema: true,
  async create(
    params: AiCreateParams,
    _apiKey?: string | null,
    orgId?: string | null,
  ): Promise<AiResponse> {
    const config = await resolveConfig(orgId);
    if (!config) {
      throw new Error(
        "OpenCode is not configured. Set OPENCODE_BASE_URL + OPENCODE_API_KEY env " +
          "vars, or configure opencodeBaseUrl + opencodeApiKey on the organization.",
      );
    }
    return callOpenAiGateway(params, {
      name: "opencode",
      modelPrefix: "opencode:",
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
  },
};
