import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { prisma } from "@octopus/db";
import { fetchPackageSource } from "@octopus/package-analyzer";
import { createAiMessage } from "@/lib/ai-router";
import { getReviewModel } from "@/lib/ai-client";
import { logAiUsage } from "@/lib/ai-usage";

const DEEP_DIVE_SYSTEM_PROMPT = `You are a security analyst specialized in npm supply chain attacks.
You are given the source code of an npm package. Analyze it thoroughly for malicious behavior.

Look for:
1. **Data exfiltration**: Does it send data to external servers? (fetch, axios, http requests with collected data)
2. **Command execution**: Does it run shell commands? (exec, spawn, child_process)
3. **File system access**: Does it read sensitive files? (.env, /etc/passwd, ssh keys, credentials)
4. **Install scripts**: Does postinstall/preinstall run suspicious code?
5. **Obfuscation**: Is code intentionally obfuscated? (eval, Buffer.from base64, encoded strings)
6. **Keylogging/clipboard**: Does it access input or clipboard?
7. **Environment harvesting**: Does it collect env vars, system info, IP addresses?
8. **Backdoors**: Hidden functionality, conditional triggers, time bombs
9. **Typosquatting indicators**: Package name similar to a popular one but with different code
10. **Dependency confusion**: Using internal-looking package names

Respond in this exact JSON format:
{
  "verdict": "malicious" | "suspicious" | "likely_safe" | "safe",
  "confidence": "high" | "medium" | "low",
  "summary": "One paragraph summary of your findings",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "title": "Short title",
      "description": "Detailed explanation",
      "file": "path/to/file.js",
      "evidence": "The specific code snippet that is suspicious"
    }
  ],
  "recommendation": "What the developer should do"
}`;

export async function POST(req: NextRequest) {
  // Auth check
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: { organizationId: true },
  });

  if (!member) {
    return Response.json({ error: "No organization found" }, { status: 403 });
  }

  const orgId = member.organizationId;

  const userId = session.user.id;

  // Parse request
  let body: { packageName: string; version?: string; analysisId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { packageName, version, analysisId } = body;
  if (!packageName || typeof packageName !== "string") {
    return Response.json({ error: "packageName is required" }, { status: 400 });
  }

  // Validate package name against npm spec to prevent SSRF/path traversal
  const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
  if (!NPM_NAME_RE.test(packageName)) {
    return Response.json({ error: "Invalid package name" }, { status: 400 });
  }

  // Rate limit: max 20 deep-dives per org per hour
  const recentDives = await prisma.packageDeepDive.count({
    where: {
      organizationId: orgId,
      userId,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });
  if (recentDives >= 20) {
    return Response.json({ error: "Rate limit exceeded. Try again later." }, { status: 429 });
  }

  try {
    // 1. Fetch package source
    console.log(`[deep-dive] Fetching source for ${packageName}@${version ?? "latest"}`);
    const source = await fetchPackageSource(packageName, version);

    if (source.files.length === 0) {
      return Response.json({ error: "Could not fetch package source files" }, { status: 404 });
    }

    // 2. Build analysis prompt
    const fileContents = source.files
      .map((f) => `--- ${f.path} (${f.size} bytes) ---\n${f.content}`)
      .join("\n\n");

    // Guard against oversized prompts
    const MAX_PROMPT_CHARS = 200_000; // ~50k tokens
    if (fileContents.length > MAX_PROMPT_CHARS) {
      return Response.json(
        { error: "Package source too large for deep-dive analysis" },
        { status: 422 },
      );
    }

    const userMessage = [
      `Analyze this npm package for malicious behavior:`,
      ``,
      `Package: ${source.name}@${source.version}`,
      `Dependencies: ${JSON.stringify(source.packageJson.dependencies ?? {}, null, 2)}`,
      `Install scripts: ${JSON.stringify(
        Object.fromEntries(
          Object.entries(source.packageJson.scripts ?? {}).filter(([k]) =>
            ["preinstall", "postinstall", "prepare", "preuninstall"].includes(k),
          ),
        ),
        null,
        2,
      )}`,
      `Files analyzed: ${source.files.length}${source.truncated ? " (truncated)" : ""}`,
      ``,
      `Source code:`,
      fileContents,
    ].join("\n");

    // 3. Call LLM
    console.log(`[deep-dive] Sending ${source.totalSize} bytes to LLM for analysis`);
    const model = await getReviewModel(orgId);

    const aiResponse = await createAiMessage(
      {
        model,
        maxTokens: 4096,
        system: DEEP_DIVE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      },
      orgId,
    );

    // Log AI usage — fire-and-forget
    logAiUsage({
      organizationId: orgId,
      operation: "package-analyze-deep-dive",
      model: aiResponse.model,
      provider: aiResponse.provider,
      inputTokens: aiResponse.usage.inputTokens,
      outputTokens: aiResponse.usage.outputTokens,
      cacheReadTokens: aiResponse.usage.cacheReadTokens,
      cacheWriteTokens: aiResponse.usage.cacheWriteTokens,
    });

    // 4. Parse response
    let analysis;
    try {
      // Extract JSON from response (might be wrapped in markdown code blocks)
      const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(aiResponse.text);
    } catch {
      analysis = {
        verdict: "suspicious",
        confidence: "low",
        summary: aiResponse.text,
        findings: [],
        recommendation: "Manual review recommended — AI response could not be parsed as structured data.",
      };
    }

    // 5. Save to DB
    const deepDive = await prisma.packageDeepDive.create({
      data: {
        packageName,
        version: source.version,
        verdict: analysis.verdict ?? "suspicious",
        confidence: analysis.confidence ?? "low",
        summary: analysis.summary ?? "",
        findings: analysis.findings ?? [],
        recommendation: analysis.recommendation ?? "",
        filesAnalyzed: source.files.length,
        totalSize: source.totalSize,
        model: aiResponse.model,
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
        organizationId: orgId,
        userId,
        analysisId: analysisId ?? null,
      },
    });

    return Response.json({
      id: deepDive.id,
      analysis,
      packageInfo: {
        name: source.name,
        version: source.version,
        filesAnalyzed: source.files.length,
        totalSize: source.totalSize,
        truncated: source.truncated,
      },
      usage: {
        model: aiResponse.model,
        inputTokens: aiResponse.usage.inputTokens,
        outputTokens: aiResponse.usage.outputTokens,
      },
    });
  } catch (err) {
    console.error("[deep-dive] Analysis failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status: 500 },
    );
  }
}
