import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { prisma } from "@octopus/db";
import { alibabaBaseUrl } from "@/lib/providers/alibaba-request";

// Vendor admin "pull latest from provider": ask each provider's own API which
// models exist, and diff against the available_models catalog. Lets the admin
// see NEW upstream models to add and catalog rows the provider no longer lists
// (candidates to retire) — so the catalog is driven by provider truth instead
// of a hand-maintained list. Guarded by the shared ADMIN_API_SECRET bearer;
// read-only (no writes). octopus-admin renders the result and the admin picks
// what to add via the existing createAvailableModel action.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DiscoveredModel {
  id: string;
  displayName: string;
  // $/1M tokens, only when the provider API reports pricing (OpenRouter does).
  inputPrice?: number;
  outputPrice?: number;
}
interface ProviderResult {
  keyConfigured: boolean;
  newUpstream: DiscoveredModel[]; // exist at provider, not in catalog
  inCatalogNotUpstream: string[]; // in catalog, provider no longer lists them
  error?: string;
}

function titleCase(id: string): string {
  return id
    .replace(/[-_:]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

async function discoverAnthropic(catalog: Set<string>): Promise<ProviderResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { keyConfigured: false, newUpstream: [], inCatalogNotUpstream: [] };
  const client = new Anthropic({ apiKey: key });
  const upstream: DiscoveredModel[] = [];
  const upstreamIds = new Set<string>();
  // Auto-paginates; Anthropic's catalog is small.
  for await (const m of client.models.list({ limit: 100 })) {
    upstreamIds.add(m.id);
    upstream.push({ id: m.id, displayName: m.display_name || titleCase(m.id) });
  }
  return {
    keyConfigured: true,
    newUpstream: upstream.filter((m) => !catalog.has(m.id)),
    inCatalogNotUpstream: [...catalog].filter((id) => !upstreamIds.has(id)),
  };
}

async function discoverOpenAI(catalog: Set<string>): Promise<ProviderResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { keyConfigured: false, newUpstream: [], inCatalogNotUpstream: [] };
  const client = new OpenAI({ apiKey: key });
  const list = await client.models.list();
  // OpenAI's list returns every id (embeddings, audio, snapshots). Keep only
  // chat-capable families and drop non-text + dated snapshots.
  const isChat = (id: string) =>
    /^(gpt-|o\d)/i.test(id) &&
    !/(embedding|whisper|tts|audio|realtime|image|dall|moderation|transcribe|search|instruct)/i.test(id) &&
    !/-\d{4}-\d{2}-\d{2}$/.test(id) &&
    !/-\d{4}$/.test(id);
  const upstreamIds = new Set<string>();
  const upstream: DiscoveredModel[] = [];
  for (const m of list.data) {
    if (!isChat(m.id)) continue;
    upstreamIds.add(m.id);
    upstream.push({ id: m.id, displayName: titleCase(m.id) });
  }
  return {
    keyConfigured: true,
    newUpstream: upstream.filter((m) => !catalog.has(m.id)),
    // Only flag catalog rows within the families we can see, so filtered-out
    // ids don't get falsely reported as retired.
    inCatalogNotUpstream: [...catalog].filter(
      (id) => /^(gpt-|o\d)/i.test(id) && !upstreamIds.has(id),
    ),
  };
}

async function discoverGoogle(catalog: Set<string>): Promise<ProviderResult> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return { keyConfigured: false, newUpstream: [], inCatalogNotUpstream: [] };
  // @google/generative-ai has no list API — hit the REST endpoint directly.
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Google models API ${res.status}`);
  const body = (await res.json()) as {
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  const upstreamIds = new Set<string>();
  const upstream: DiscoveredModel[] = [];
  for (const m of body.models ?? []) {
    if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
    const id = m.name.replace(/^models\//, "");
    upstreamIds.add(id);
    upstream.push({ id, displayName: m.displayName || titleCase(id) });
  }
  return {
    keyConfigured: true,
    newUpstream: upstream.filter((m) => !catalog.has(m.id)),
    inCatalogNotUpstream: [...catalog].filter((id) => !upstreamIds.has(id)),
  };
}

async function discoverGrok(catalog: Set<string>): Promise<ProviderResult> {
  const key = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  if (!key) return { keyConfigured: false, newUpstream: [], inCatalogNotUpstream: [] };
  // xAI is OpenAI-compatible (same as the grok provider adapter).
  const client = new OpenAI({ apiKey: key, baseURL: "https://api.x.ai/v1" });
  const list = await client.models.list();
  const upstreamIds = new Set<string>();
  const upstream: DiscoveredModel[] = [];
  for (const m of list.data) {
    if (!/^grok/i.test(m.id)) continue;
    upstreamIds.add(m.id);
    upstream.push({ id: m.id, displayName: titleCase(m.id) });
  }
  return {
    keyConfigured: true,
    newUpstream: upstream.filter((m) => !catalog.has(m.id)),
    inCatalogNotUpstream: [...catalog].filter((id) => !upstreamIds.has(id)),
  };
}

async function discoverAlibaba(catalog: Set<string>): Promise<ProviderResult> {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) return { keyConfigured: false, newUpstream: [], inCatalogNotUpstream: [] };
  // DashScope compatible-mode is OpenAI-compatible (same as the alibaba provider adapter).
  const client = new OpenAI({ apiKey: key, baseURL: alibabaBaseUrl() });
  const list = await client.models.list();
  const upstreamIds = new Set<string>();
  const upstream: DiscoveredModel[] = [];
  for (const m of list.data) {
    if (!/^qwen/i.test(m.id)) continue;
    upstreamIds.add(m.id);
    upstream.push({ id: m.id, displayName: titleCase(m.id) });
  }
  return {
    keyConfigured: true,
    newUpstream: upstream.filter((m) => !catalog.has(m.id)),
    inCatalogNotUpstream: [...catalog].filter((id) => !upstreamIds.has(id)),
  };
}

// OpenRouter lists 300+ models; surface only notable labs (plus anything Kimi)
// so the panel isn't flooded. Ids are namespaced "lab/model" (the grok/
// openrouter adapters pass them verbatim).
const OPENROUTER_LABS = new Set([
  "moonshotai",
  "x-ai",
  "deepseek",
  "qwen",
  "mistralai",
  "meta-llama",
  "cohere",
  "nvidia",
  "microsoft",
  "z-ai",
  "minimax",
  "amazon",
]);

async function discoverOpenRouter(catalog: Set<string>): Promise<ProviderResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { keyConfigured: false, newUpstream: [], inCatalogNotUpstream: [] };
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OpenRouter models API ${res.status}`);
  const body = (await res.json()) as {
    data?: { id: string; name?: string; pricing?: { prompt?: string; completion?: string } }[];
  };
  const upstream: DiscoveredModel[] = [];
  for (const m of body.data ?? []) {
    if (m.id.endsWith(":free")) continue;
    const lab = m.id.split("/")[0]?.toLowerCase() ?? "";
    if (!OPENROUTER_LABS.has(lab) && !/kimi/i.test(m.id)) continue;
    // OpenRouter prices are USD per token → $/1M tokens.
    const inP = m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1e6 : NaN;
    const outP = m.pricing?.completion ? parseFloat(m.pricing.completion) * 1e6 : NaN;
    upstream.push({
      id: m.id,
      displayName: m.name || titleCase(m.id),
      ...(isFinite(inP) ? { inputPrice: Number(inP.toFixed(3)) } : {}),
      ...(isFinite(outP) ? { outputPrice: Number(outP.toFixed(3)) } : {}),
    });
  }
  return {
    keyConfigured: true,
    newUpstream: upstream.filter((m) => !catalog.has(m.id)),
    // Filtered view — don't flag catalog rows as retired from it.
    inCatalogNotUpstream: [],
  };
}

export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.availableModel.findMany({
    select: { modelId: true, provider: true },
  });
  const byProvider = (p: string) =>
    new Set(rows.filter((r) => r.provider === p).map((r) => r.modelId));

  // Each provider isolated: one failing (bad key, outage) must not sink the rest.
  const settle = async (fn: () => Promise<ProviderResult>): Promise<ProviderResult> => {
    try {
      return await fn();
    } catch (e) {
      return {
        keyConfigured: true,
        newUpstream: [],
        inCatalogNotUpstream: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };

  const [anthropic, openai, google, grok, openrouter, alibaba] = await Promise.all([
    settle(() => discoverAnthropic(byProvider("anthropic"))),
    settle(() => discoverOpenAI(byProvider("openai"))),
    settle(() => discoverGoogle(byProvider("google"))),
    settle(() => discoverGrok(byProvider("grok"))),
    settle(() => discoverOpenRouter(byProvider("openrouter"))),
    settle(() => discoverAlibaba(byProvider("alibaba"))),
  ]);

  return NextResponse.json({
    ok: true,
    providers: { anthropic, openai, google, grok, openrouter, alibaba },
  });
}
