import "server-only";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { callOpenAiGateway } from "./openai-gateway";

/**
 * ACPX — an OpenAI-compatible multi-vendor gateway (Agent Communication
 * Protocol). Configured per deployment via env:
 *   ACP_BASE_URL — gateway origin (e.g. https://acpx.internal.example.com)
 *   ACP_API_KEY  — bearer token for the gateway
 * Model ids are namespaced "acp:<model>".
 */
export const acpProvider: Provider = {
  name: "acp",
  supportsJsonSchema: true,
  async create(params: AiCreateParams): Promise<AiResponse> {
    const baseUrl = process.env.ACP_BASE_URL;
    const apiKey = process.env.ACP_API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error("ACPX is not configured — set ACP_BASE_URL and ACP_API_KEY.");
    }
    return callOpenAiGateway(params, {
      name: "acp",
      modelPrefix: "acp:",
      baseUrl,
      apiKey,
    });
  },
};
