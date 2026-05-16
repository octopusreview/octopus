#!/usr/bin/env bun
/**
 * AI Gateway smoke test.
 *
 * Sends "ping" to each of the three chat endpoints (Claude / OpenAI / Gemini)
 * and the embeddings endpoint. Asserts the response has expected shape.
 *
 * Requires: DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET.
 */

import { createAiMessage } from "../../apps/web/lib/ai-router";
import { createEmbeddings } from "../../apps/web/lib/embeddings";

async function chat(label: string, model: string): Promise<void> {
  console.log(`[smoke] ${label} → ${model}`);
  const r = await createAiMessage(
    {
      model,
      maxTokens: 32,
      messages: [{ role: "user", content: "Reply with the word PING and nothing else." }],
    },
    "smoke-org",
  );
  if (!r.text) throw new Error(`${label}: empty response`);
  if (r.usage.inputTokens === 0) throw new Error(`${label}: usage.inputTokens=0`);
  console.log(`[smoke]   ✅ "${r.text.trim().slice(0, 40)}" (in=${r.usage.inputTokens} out=${r.usage.outputTokens})`);
}

async function embed(): Promise<void> {
  console.log(`[smoke] embeddings → text-embedding-3-large`);
  const vs = await createEmbeddings(["hello world"]);
  const v = vs[0];
  if (!v || v.length !== 3072) throw new Error(`expected 3072-dim vector, got ${v?.length ?? "none"}`);
  console.log(`[smoke]   ✅ dim=${v.length}`);
}

async function main(): Promise<void> {
  await chat("claude", "claude-sonnet-4-6-20250619");
  await chat("openai", "gpt-4o");
  await chat("gemini", "gemini-2.5-pro");
  await embed();
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
