import "server-only";
import type { Provider, AiCreateParams, AiResponse } from "./index";

/**
 * Test-only provider that always throws. Lets tests verify retry / fallback
 * / error-surfacing logic without needing a fragile real-API failure mode.
 *
 * The error message includes the model id and call context so test
 * assertions can be specific.
 */
export const mockFailProvider: Provider = {
  name: "mock-fail",
  supportsJsonSchema: false,
  async create(params: AiCreateParams, _apiKey?: string | null): Promise<AiResponse> {
    throw new Error(
      `mock-fail provider: deliberate failure for model ${params.model} (maxTokens=${params.maxTokens})`,
    );
  },
};
