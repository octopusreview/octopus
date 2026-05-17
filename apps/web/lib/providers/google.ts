import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Provider, AiCreateParams, AiResponse } from "./index";

let platformClient: GoogleGenerativeAI | null = null;

function getClient(apiKey?: string | null): GoogleGenerativeAI {
  if (apiKey) return new GoogleGenerativeAI(apiKey);
  if (!platformClient) {
    platformClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  }
  return platformClient;
}

export const googleProvider: Provider = {
  name: "google",
  supportsJsonSchema: true,
  async create(params: AiCreateParams, apiKey?: string | null): Promise<AiResponse> {
    const genAI = getClient(apiKey);
    const model = genAI.getGenerativeModel({ model: params.model });

    const contents = params.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const result = await model.generateContent({
      contents,
      systemInstruction: params.system
        ? { role: "user", parts: [{ text: params.system }] }
        : undefined,
      generationConfig: {
        maxOutputTokens: params.maxTokens,
        ...(params.responseSchema
          ? {
              responseMimeType: "application/json",
              // Google's SDK types use its own SchemaType union; cast since we
              // accept any JSON-Schema-shaped object at the public boundary.
              responseSchema: params.responseSchema.schema as never,
            }
          : {}),
      },
    });

    const response = result.response;
    const text = response.text();
    const usage = response.usageMetadata;

    return {
      text,
      provider: "google",
      model: params.model,
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  },
};
