import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Provider, AiCreateParams, AiResponse } from "./index";

let platformClient: Anthropic | null = null;

function getClient(apiKey?: string | null): Anthropic {
  if (apiKey) return new Anthropic({ apiKey });
  if (!platformClient) {
    platformClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return platformClient;
}

export const anthropicProvider: Provider = {
  name: "anthropic",
  supportsJsonSchema: true,
  async create(params: AiCreateParams, apiKey?: string | null): Promise<AiResponse> {
    const client = getClient(apiKey);

    // When a responseSchema is provided, use Anthropic tool-use for enforced
    // structured output: define a single tool whose input_schema matches the
    // requested shape, force it via tool_choice, then return the tool input.
    const useTool = params.responseSchema !== undefined;

    const response = await client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system
        ? [
            {
              type: "text" as const,
              text: params.system,
              ...(params.cacheSystem
                ? { cache_control: { type: "ephemeral" as const } }
                : {}),
            },
          ]
        : undefined,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      ...(useTool
        ? {
            tools: [
              {
                name: params.responseSchema!.name,
                description: `Return the response as a ${params.responseSchema!.name} object.`,
                input_schema: params.responseSchema!.schema as Anthropic.Tool.InputSchema,
              },
            ],
            tool_choice: {
              type: "tool" as const,
              name: params.responseSchema!.name,
            },
          }
        : {}),
    });

    let text = "";
    if (useTool) {
      const toolUse = response.content.find((c) => c.type === "tool_use");
      if (toolUse && toolUse.type === "tool_use") {
        text = JSON.stringify(toolUse.input);
      }
    } else {
      const textBlock = response.content[0];
      text = textBlock?.type === "text" ? textBlock.text : "";
    }

    return {
      text,
      provider: "anthropic",
      model: params.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  },
};
