import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { ORGANIZATION_ENTITY, ORGANIZATION_JSON_LD, SOCIAL_PROFILES, jsonLd } from "@/lib/structured-data";
import { docsContent } from "@/lib/docs-content";
import { GET, renderLlmsFull } from "@/app/llms-full.txt/route";

describe("Organization entity", () => {
  it("is one addressable entity with public profiles", () => {
    expect(ORGANIZATION_ENTITY["@id"]).toBe("https://octopus-review.ai/#organization");
    expect(SOCIAL_PROFILES.length).toBeGreaterThanOrEqual(5);
    for (const url of ORGANIZATION_JSON_LD.sameAs) expect(url).toMatch(/^https:\/\//);
    expect(jsonLd({ a: "</script><script>alert(1)" })).not.toContain("</script>");
  });
});

describe("llms.txt files", () => {
  const short = readFileSync(new URL("../../public/llms.txt", import.meta.url), "utf8");

  it("llms.txt names every vendor and surface and links the full file", () => {
    for (const needle of ["Grok", "Qwen", "OpenRouter", "GPT-6 Astra", "GitHub Action", "CLI", "MCP", "/blog", "llms-full.txt", "source-available"]) {
      expect(short).toContain(needle);
    }
    expect(short).not.toMatch(/open[- ]source/i);
    expect(short.startsWith("# Octopus\n\n> ")).toBe(true);
  });

  it("llms-full.txt is served as text and carries every documented page", async () => {
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toBe(renderLlmsFull());
    for (const doc of docsContent) expect(body).toContain(`## ${doc.title}`);
    expect(body).toContain("GPT-6 Astra");
  });
});
