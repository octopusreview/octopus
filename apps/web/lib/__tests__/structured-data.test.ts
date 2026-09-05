import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ORGANIZATION_ENTITY,
  ORGANIZATION_JSON_LD,
  SOCIAL_PROFILES,
  blogItemListJsonLd,
  docsPageJsonLd,
  jsonLd,
  pricingProductJsonLd,
} from "@/lib/structured-data";
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

describe("docsPageJsonLd", () => {
  it("emits a WebPage tied to the organization plus a two-level breadcrumb", () => {
    const g = docsPageJsonLd({ title: "Pricing — Octopus Docs", description: "d", path: "/docs/pricing", crumb: "Pricing" });
    const [page, crumbs] = g["@graph"] as [Record<string, unknown>, { itemListElement: Array<{ name: string; item: string; position: number }> }];
    expect(page["@type"]).toBe("WebPage");
    expect(page.url).toBe("https://octopus-review.ai/docs/pricing");
    expect((page.publisher as { "@id": string })["@id"]).toBe(ORGANIZATION_ENTITY["@id"]);
    expect(crumbs.itemListElement.map((c) => [c.position, c.name])).toEqual([[1, "Docs"], [2, "Pricing"]]);
    expect(crumbs.itemListElement[1].item).toBe("https://octopus-review.ai/docs/pricing");
  });
});

describe("pricingProductJsonLd", () => {
  it("describes a free-to-start, usage-billed product sold by the organization", () => {
    const p = pricingProductJsonLd();
    expect(p["@type"]).toBe("Product");
    expect(p.brand["@id"]).toBe(ORGANIZATION_ENTITY["@id"]);
    expect(p.offers.price).toBe("0");
    expect(p.offers.priceCurrency).toBe("USD");
    expect(p.offers.description).toMatch(/2x the AI provider/);
    expect(p.url).toBe("https://octopus-review.ai/docs/pricing");
  });
});

describe("blogItemListJsonLd", () => {
  it("lists posts in page order with absolute urls and dates", () => {
    const list = blogItemListJsonLd([
      { slug: "a", title: "A", publishedAt: new Date("2026-09-04T00:00:00Z") },
      { slug: "b", title: "B", publishedAt: null },
    ]);
    expect(list.numberOfItems).toBe(2);
    expect(list.itemListElement[0]).toMatchObject({ position: 1, url: "https://octopus-review.ai/blog/a", name: "A", datePublished: "2026-09-04T00:00:00.000Z" });
    expect(list.itemListElement[1]).not.toHaveProperty("datePublished");
  });
});

describe("llms.txt files", () => {
  const short = readFileSync(new URL("../../public/llms.txt", import.meta.url), "utf8");

  it("llms.txt names every vendor and surface and links the full file", () => {
    for (const needle of ["Grok", "Qwen", "OpenRouter", "GPT-6 Astra", "GitHub Action", "CLI", "MCP", "/blog", "llms-full.txt", "source-available", "Grok 4.6", "Kimi K3", "/docs/glossary", "/compare"]) {
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
