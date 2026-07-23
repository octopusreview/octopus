import "server-only";
import { prisma } from "@octopus/db";
import { decryptStringMaybeLegacy } from "@/lib/crypto";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { callOpenAiGateway } from "./openai-gateway";
import { validateProviderUrl } from "./url-validation";

/**
 * ACPX — an OpenAI-compatible multi-vendor gateway (Agent Communication
 * Protocol). Configurable per-org (Organization.acpBaseUrl + acpApiKey),
 * which overrides the deployment-wide env default:
 *   ACP_BASE_URL — gateway origin (e.g. https://acpx.internal.example.com)
 *   ACP_API_KEY  — bearer token for the gateway
 * Model ids are namespaced "acp:<model>".
 *
 * The per-org key is stored encrypted at rest like the other BYOK keys, so it
 * is decrypted here before use. SSRF validation is applied only to the per-org
 * (org-admin supplied) base URL; the env-configured ACP_BASE_URL is operator-
 * controlled and may legitimately point at an internal host, so it is only
 * normalized to an origin (private ranges allowed).
 */
async function resolveConfig(orgId?: string | null): Promise<{ baseUrl: string; apiKey: string } | null> {
  // Per-org config overrides the deployment env default.
  if (orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { acpBaseUrl: true, acpApiKey: true },
    });
    if (org?.acpBaseUrl && org?.acpApiKey) {
      return { baseUrl: validateProviderUrl(org.acpBaseUrl), apiKey: decryptStringMaybeLegacy(org.acpApiKey) };
    }
  }
  const envBase = process.env.ACP_BASE_URL;
  const envKey = process.env.ACP_API_KEY;
  if (envBase && envKey) return { baseUrl: validateProviderUrl(envBase, { hosted: false }), apiKey: envKey };
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
        "ACPX is not configured — set ACP_BASE_URL and ACP_API_KEY, or " +
          "configure acpBaseUrl and acpApiKey on the organization.",
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
