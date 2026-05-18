import "server-only";
import { prisma } from "@octopus/db";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { callOpenAiGateway } from "./openai-gateway";

/**
 * ACPX — multiplexer over multiple model vendors (Claude / Pi / Gemini / …)
 * via the Agent Communication Protocol. Most ACP-compatible servers expose
 * an OpenAI-compatible Chat Completions endpoint, so we reuse the shared
 * `callOpenAiGateway` helper.
 *
 * Per-org config required:
 *   Organization.acpBaseUrl — e.g. https://acpx.internal.acme.com
 *   Organization.acpApiKey  — bearer token for the ACPX gateway
 *
 * Self-hosters can also set ACP_BASE_URL + ACP_API_KEY env vars for a
 * single global config.
 *
 * Model IDs are namespaced — `acp:claude-…`, `acp:gemini-…`, etc.
 */

async function resolveConfig(orgId?: string | null): Promise<{ baseUrl: string; apiKey: string } | null> {
  const envBase = process.env.ACP_BASE_URL;
  const envKey = process.env.ACP_API_KEY;
  if (envBase && envKey) return { baseUrl: envBase, apiKey: envKey };

  if (!orgId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { acpBaseUrl: true, acpApiKey: true },
  });
  if (org?.acpBaseUrl && org?.acpApiKey) {
    return { baseUrl: org.acpBaseUrl, apiKey: org.acpApiKey };
  }
  return null;
}

export const acpProvider: Provider = {
  name: "acp",
  supportsJsonSchema: true,
  async create(
    params: AiCreateParams,
    _apiKey?: string | null,
    orgId?: string | null,
  ): Promise<AiResponse> {
    const config = await resolveConfig(orgId);
    if (!config) {
      throw new Error(
        "ACPX is not configured. Set ACP_BASE_URL + ACP_API_KEY env vars, or " +
          "configure acpBaseUrl + acpApiKey on the organization.",
      );
    }
    return callOpenAiGateway(params, {
      name: "acp",
      modelPrefix: "acp:",
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
  },
};
