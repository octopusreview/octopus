import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

// Calls the real middleware and reports what a visitor gets: the page is
// served, they are sent to sign in, or the router is asked for its 404 page.
type Outcome = { kind: "served" } | { kind: "login"; callbackUrl: string | null } | { kind: "not-found" };

function visit(path: string, signedIn = false): Outcome {
  const request = new NextRequest(`https://octopus-review.ai${path}`, {
    headers: signedIn ? { cookie: "better-auth.session_token=session" } : {},
  });
  const response = middleware(request);
  if (response.headers.get("x-middleware-next") === "1") return { kind: "served" };
  const location = response.headers.get("location");
  if (location) {
    const target = new URL(location);
    expect(target.pathname).toBe("/login");
    return { kind: "login", callbackUrl: target.searchParams.get("callbackUrl") };
  }
  // A rewrite to a path no route answers: the router renders its 404 page.
  expect(new URL(response.headers.get("x-middleware-rewrite")!).pathname).toBe("/_not-found");
  return { kind: "not-found" };
}

/** Every page the app serves, as a URL path, read from the route folders the router itself uses. */
function pageRoutes(dir = join(import.meta.dir, "../../app"), segments: string[] = []): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "api" && segments.length === 0) continue;
      const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      const segment = entry.name.startsWith("[") ? "sample" : entry.name;
      routes.push(...pageRoutes(join(dir, entry.name), isGroup ? segments : [...segments, segment]));
    } else if (entry.name === "page.tsx") {
      routes.push("/" + segments.join("/"));
    }
  }
  return routes;
}

describe("signed-out visitors", () => {
  it("get a 404, not a sign-in redirect, for a path that is not a page", () => {
    for (const path of ["/pricing-typo", "/Blog", "/features", "/wp-admin", "/dashboardx", "/settingsfoo/bar", "/coupon", "/coupon/anything"]) {
      expect(visit(path), path).toEqual({ kind: "not-found" });
    }
  });

  it("are still sent to sign in for pages that need a session, and come back to the same page", () => {
    expect(visit("/settings/models")).toEqual({ kind: "login", callbackUrl: "/settings/models" });
    expect(visit("/repositories?tab=all")).toEqual({ kind: "login", callbackUrl: "/repositories?tab=all" });
    expect(visit("/invitation/abc123")).toEqual({ kind: "login", callbackUrl: "/invitation/abc123" });
    expect(visit("/admin/settings")).toEqual({ kind: "login", callbackUrl: "/admin/settings" });
    expect(visit("/dashboard")).toEqual({ kind: "login", callbackUrl: null });
  });

  it("are still sent to sign in for API paths that are not public", () => {
    expect(visit("/api/orgs/abc/members").kind).toBe("login");
    expect(visit("/api/no-such-endpoint").kind).toBe("login");
  });

  it("are served public pages", () => {
    for (const path of ["/", "/blog", "/blog/some-post", "/docs/pricing", "/compare", "/vs-coderabbit", "/editor", "/login", "/status"]) {
      expect(visit(path), path).toEqual({ kind: "served" });
    }
  });

  it("never get a 404 for a page that exists", () => {
    const routes = pageRoutes();
    expect(routes.length).toBeGreaterThan(50);
    expect(routes).toContain("/dashboard");
    expect(routes).toContain("/docs/pricing");
    for (const path of routes) expect(visit(path).kind, path).not.toBe("not-found");
  });
});

describe("signed-in visitors", () => {
  it("reach the router for any path, which answers 404 itself for unknown ones", () => {
    expect(visit("/dashboard", true)).toEqual({ kind: "served" });
    expect(visit("/pricing-typo", true)).toEqual({ kind: "served" });
  });
});
