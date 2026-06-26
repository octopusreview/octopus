import "server-only";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { callOpenAiGateway } from "./openai-gateway";

/**
 * OpenCode — an OpenAI-compatible gateway, same shape as ACPX with its own
 * config. Configured per deployment via env:
 *   OPENCODE_BASE_URL — gateway origin
 *   OPENCODE_API_KEY  — bearer token for the gateway
 * Model ids are namespaced "opencode:<model>".
 */
export const opencodeProvider: Provider = {
  name: "opencode",
  supportsJsonSchema: true,
  async create(params: AiCreateParams): Promise<AiResponse> {
    const baseUrl = process.env.OPENCODE_BASE_URL;
    const apiKey = process.env.OPENCODE_API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error("OpenCode is not configured — set OPENCODE_BASE_URL and OPENCODE_API_KEY.");
    }
    return callOpenAiGateway(params, {
      name: "opencode",
      modelPrefix: "opencode:",
      baseUrl,
      apiKey,
    });
  },
};
