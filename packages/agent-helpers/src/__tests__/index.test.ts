import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  resolveConfigFromEnv,
  queryOctopusBeforeCoding,
  formatPreCodingContext,
  octopusRequest,
  fetchConventions,
  queryCodebase,
  fetchFileContext,
  fetchSimilarFiles,
  type PreCodingContext,
  type OctopusConfig,
} from "../index.js";

describe("resolveConfigFromEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env["OCTOPUS_API_URL"] = "https://api.octopus.test";
    process.env["OCTOPUS_API_KEY"] = "test-key-123";
    process.env["OCTOPUS_REPO"] = "test-org/test-repo";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves config from environment variables", () => {
    const config = resolveConfigFromEnv();
    expect(config.apiUrl).toBe("https://api.octopus.test");
    expect(config.apiKey).toBe("test-key-123");
    expect(config.repo).toBe("test-org/test-repo");
  });

  it("applies overrides over environment variables", () => {
    const config = resolveConfigFromEnv({ repo: "override-org/override-repo" });
    expect(config.repo).toBe("override-org/override-repo");
    expect(config.apiUrl).toBe("https://api.octopus.test");
  });

  it("throws when OCTOPUS_API_URL is missing", () => {
    delete process.env["OCTOPUS_API_URL"];
    expect(() => resolveConfigFromEnv()).toThrow("OCTOPUS_API_URL is required");
  });

  it("throws when OCTOPUS_API_KEY is missing", () => {
    delete process.env["OCTOPUS_API_KEY"];
    expect(() => resolveConfigFromEnv()).toThrow("OCTOPUS_API_KEY is required");
  });

  it("throws when OCTOPUS_REPO is missing", () => {
    delete process.env["OCTOPUS_REPO"];
    expect(() => resolveConfigFromEnv()).toThrow("OCTOPUS_REPO is required");
  });
});

describe("formatPreCodingContext", () => {
  it("formats a complete context with conventions and query", () => {
    const context: PreCodingContext = {
      task: "Add pagination to signals endpoint",
      repo: "Art-of-Technology/octopus",
      conventions: {
        conventions: "Use cursor-based pagination for all list endpoints.",
        patterns: ["Prisma findMany with take/skip", "Zod validation on inputs"],
      },
      query: "Relevant patterns found in apps/web/app/api/signals/route.ts",
      errors: [],
    };

    const formatted = formatPreCodingContext(context);
    expect(formatted).toContain("## Octopus Pre-Coding Context");
    expect(formatted).toContain("Add pagination to signals endpoint");
    expect(formatted).toContain("cursor-based pagination");
    expect(formatted).toContain("Prisma findMany with take/skip");
    expect(formatted).toContain("Relevant patterns found");
    expect(formatted).not.toContain("Warnings");
  });

  it("includes warnings when errors are present", () => {
    const context: PreCodingContext = {
      task: "Test task",
      repo: "test/repo",
      conventions: null,
      query: null,
      errors: ["Conventions fetch failed: timeout"],
    };

    const formatted = formatPreCodingContext(context);
    expect(formatted).toContain("### Warnings");
    expect(formatted).toContain("Conventions fetch failed: timeout");
  });

  it("handles context with no conventions or query", () => {
    const context: PreCodingContext = {
      task: "Test task",
      repo: "test/repo",
      conventions: null,
      query: null,
      errors: [],
    };

    const formatted = formatPreCodingContext(context);
    expect(formatted).toContain("## Octopus Pre-Coding Context");
    expect(formatted).toContain("Test task");
    expect(formatted).not.toContain("### Coding Conventions");
    expect(formatted).not.toContain("### Relevant Codebase Context");
  });

  it("formats object query as JSON", () => {
    const context: PreCodingContext = {
      task: "Test task",
      repo: "test/repo",
      conventions: null,
      query: { answer: "use prisma", files: ["db.ts"] },
      errors: [],
    };

    const formatted = formatPreCodingContext(context);
    expect(formatted).toContain("### Relevant Codebase Context");
    expect(formatted).toContain("use prisma");
    expect(formatted).toContain("db.ts");
  });

  it("formats string query directly", () => {
    const context: PreCodingContext = {
      task: "Test",
      repo: "test/repo",
      conventions: null,
      query: "Use the existing auth middleware",
      errors: [],
    };

    const formatted = formatPreCodingContext(context);
    expect(formatted).toContain("Use the existing auth middleware");
  });

  it("includes all patterns in conventions", () => {
    const context: PreCodingContext = {
      task: "Test",
      repo: "test/repo",
      conventions: {
        conventions: "Follow DRY.",
        patterns: ["Pattern A", "Pattern B", "Pattern C"],
      },
      query: null,
      errors: [],
    };

    const formatted = formatPreCodingContext(context);
    expect(formatted).toContain("- Pattern A");
    expect(formatted).toContain("- Pattern B");
    expect(formatted).toContain("- Pattern C");
  });

  it("includes multiple warnings", () => {
    const context: PreCodingContext = {
      task: "Test",
      repo: "test/repo",
      conventions: null,
      query: null,
      errors: ["Error 1", "Error 2"],
    };

    const formatted = formatPreCodingContext(context);
    expect(formatted).toContain("Error 1");
    expect(formatted).toContain("Error 2");
  });
});

describe("octopusRequest", () => {
  const config: OctopusConfig = {
    apiUrl: "https://api.octopus.test",
    apiKey: "test-key-123",
    repo: "test-org/test-repo",
  };

  afterEach(() => {
    mock.restore();
  });

  it("sends POST request with correct headers and body", async () => {
    const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result: "ok" }), { status: 200 }),
    );

    await octopusRequest(config, "/api/test", { foo: "bar" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.octopus.test/api/test");
    expect(options.method).toBe("POST");
    const headers = options.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer test-key-123");
    expect(JSON.parse(options.body as string)).toEqual({ foo: "bar" });
  });

  it("returns ok: true with data on success", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ conventions: "use tabs" }), { status: 200 }),
    );

    const result = await octopusRequest(config, "/api/conventions", { repo: "test" });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ conventions: "use tabs" });
  });

  it("returns ok: false with error on non-200 response", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );

    const result = await octopusRequest(config, "/api/missing", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("404");
  });

  it("returns ok: false on network error", async () => {
    spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await octopusRequest(config, "/api/test", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("strips trailing slash from apiUrl", async () => {
    const configWithSlash: OctopusConfig = {
      ...config,
      apiUrl: "https://api.octopus.test/",
    };

    const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await octopusRequest(configWithSlash, "/api/test", {});
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.octopus.test/api/test");
  });
});

describe("fetchConventions", () => {
  const config: OctopusConfig = {
    apiUrl: "https://api.octopus.test",
    apiKey: "test-key",
    repo: "org/repo",
  };

  afterEach(() => {
    mock.restore();
  });

  it("calls /api/conventions with repo", async () => {
    const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ conventions: "use strict", patterns: [] }), { status: 200 }),
    );

    const result = await fetchConventions(config);
    expect(result.ok).toBe(true);
    expect(result.data?.conventions).toBe("use strict");
    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.repo).toBe("org/repo");
  });
});

describe("queryCodebase", () => {
  const config: OctopusConfig = {
    apiUrl: "https://api.octopus.test",
    apiKey: "test-key",
    repo: "org/repo",
  };

  afterEach(() => {
    mock.restore();
  });

  it("calls /api/query with question and repo", async () => {
    const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ answer: "use prisma" }), { status: 200 }),
    );

    const result = await queryCodebase(config, "How do I access the database?");
    expect(result.ok).toBe(true);
    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.query).toBe("How do I access the database?");
    expect(body.repo).toBe("org/repo");
  });
});

describe("fetchFileContext", () => {
  const config: OctopusConfig = {
    apiUrl: "https://api.octopus.test",
    apiKey: "test-key",
    repo: "org/repo",
  };

  afterEach(() => {
    mock.restore();
  });

  it("calls /api/context with file path and repo", async () => {
    const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ file: "src/auth.ts", summary: "Auth module", related: [] }), { status: 200 }),
    );

    const result = await fetchFileContext(config, "src/auth.ts");
    expect(result.ok).toBe(true);
    expect(result.data?.file).toBe("src/auth.ts");
    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.file).toBe("src/auth.ts");
  });
});

describe("fetchSimilarFiles", () => {
  const config: OctopusConfig = {
    apiUrl: "https://api.octopus.test",
    apiKey: "test-key",
    repo: "org/repo",
  };

  afterEach(() => {
    mock.restore();
  });

  it("calls /api/similar with file path and repo", async () => {
    const mockFetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ files: ["src/auth.ts", "src/middleware.ts"] }), { status: 200 }),
    );

    const result = await fetchSimilarFiles(config, "src/auth.ts");
    expect(result.ok).toBe(true);
    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.file).toBe("src/auth.ts");
  });
});

describe("queryOctopusBeforeCoding", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env["OCTOPUS_API_URL"] = "https://api.octopus.test";
    process.env["OCTOPUS_API_KEY"] = "test-key-123";
    process.env["OCTOPUS_REPO"] = "default/repo";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    mock.restore();
  });

  it("returns conventions and query on success", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      (() => Promise.resolve(new Response(JSON.stringify({ conventions: "use tabs", patterns: ["pattern1"] }), { status: 200 }))) as unknown as typeof fetch,
    );

    const result = await queryOctopusBeforeCoding("Add auth", "org/repo");
    expect(result.task).toBe("Add auth");
    expect(result.repo).toBe("org/repo");
    expect(result.conventions).toBeDefined();
    expect(result.errors.length).toBe(0);
  });

  it("captures errors when API fails", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      (() => Promise.resolve(new Response("Internal Server Error", { status: 500 }))) as unknown as typeof fetch,
    );

    const result = await queryOctopusBeforeCoding("Add auth", "org/repo");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.conventions).toBeNull();
  });

  it("captures errors when fetch throws", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      (() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch,
    );

    const result = await queryOctopusBeforeCoding("Add auth", "org/repo");
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
