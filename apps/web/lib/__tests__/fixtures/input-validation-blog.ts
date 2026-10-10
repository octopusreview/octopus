import assert from "node:assert/strict";
import { mock } from "bun:test";
import { NextRequest } from "next/server";

const queries: { skip?: number; where: unknown }[] = [];
let searchPosts: { title: string; slug: string; excerpt: string | null }[] = [];
let databaseError: Error | undefined;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
mock.module("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
mock.module("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
mock.module("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
mock.module("@octopus/db", () => ({ prisma: { blogPost: {
  findMany: async (args: { skip?: number; where: unknown }) => {
    queries.push(args);
    if (databaseError) throw databaseError;
    return searchPosts;
  },
  count: async () => 0,
  groupBy: async () => [],
} } }));
for (const [name, exported] of [
  ["landing-footer", "LandingFooter"], ["landing-mobile-nav", "LandingMobileNav"],
  ["landing-desktop-nav", "LandingDesktopNav"], ["blog-search", "BlogSearch"],
  ["scroll-to-top", "ScrollToTop"], ["link", "default"],
]) mock.module(`@/components/${name}`, () => ({ [exported!]: () => null }));
const page = (await import("@/app/(landing)/blog/page")).default;
for (const key of ["q", "category", "tag", "page"]) {
  for (const value of [["a", "b"], "nul\0value", "\ud800", "x".repeat(1025)]) {
    queries.length = 0;
    await assert.rejects(() => page({ searchParams: Promise.resolve({ [key]: value }) as never }), /not-found/);
    assert.deepEqual(queries, [], "malformed filters must not reach the database");
  }
}
for (const value of ["999999999999999999999", "214748366", "1e309", "1.5", "-1", "bad"]) {
  queries.length = 0;
  await assert.rejects(() => page({ searchParams: Promise.resolve({ page: value }) }), /not-found/);
  assert.deepEqual(queries, []);
}
await page({ searchParams: Promise.resolve({ page: "2", q: "  AI 🐙  ", category: "Engineering", tag: "review" }) });
assert.equal(queries[0]!.skip, 10);
assert.deepEqual(queries[0]!.where, {
  status: "published", deletedAt: null,
  OR: ["title", "excerpt", "content"].map((key) => ({ [key]: { contains: "AI 🐙", mode: "insensitive" } })),
  category: "Engineering", tags: { has: "review" },
});
queries.length = 0;
await page({ searchParams: Promise.resolve({}) });
assert.equal(queries[0]!.skip, 0);
const search = (await import("@/app/api/blog/search/route")).GET;
for (const params of [
  "q=bad%00value", "q=valid&q=bad%00value", "q=bad%00value&q=valid", "q=one&q=two",
  `q=${"x".repeat(1025)}`, `q=${"%20".repeat(1025)}`,
]) {
  queries.length = 0;
  const response = await search(new NextRequest(`https://octopus.example/api/blog/search?${params}`));
  assert.equal(response.status, 400, params);
  assert.deepEqual(await response.json(), { error: "Invalid search query" });
  assert.deepEqual(queries, [], "malformed autocomplete queries must not reach the database");
}
for (const params of ["", "q=", "q=%20%20"]) {
  queries.length = 0;
  const response = await search(new NextRequest(`https://octopus.example/api/blog/search?${params}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { posts: [] });
  assert.deepEqual(queries, []);
}
searchPosts = [{ title: "AI 🐙", slug: "ai-review", excerpt: null }];
for (const value of ["  AI 🐙  ", "x".repeat(1024)]) {
  queries.length = 0;
  const response = await search(new NextRequest(`https://octopus.example/api/blog/search?q=${encodeURIComponent(value)}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { posts: searchPosts });
  assert.deepEqual(queries, [{
    where: {
      status: "published", deletedAt: null,
      OR: ["title", "excerpt", "content"].map((key) => ({ [key]: { contains: value.trim(), mode: "insensitive" } })),
    },
    orderBy: { publishedAt: "desc" },
    take: 10,
    select: { title: true, slug: true, excerpt: true },
  }]);
}
databaseError = new Error("database unavailable");
await assert.rejects(() => search(new NextRequest("https://octopus.example/api/blog/search?q=AI")), databaseError);
console.log("input validation checks passed");
