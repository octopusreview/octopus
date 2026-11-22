import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";

// ── Mock external dependencies before importing ──

// `server-only` is a Next.js marker module that throws outside a Server
// Component context; neutralize it for bun test (same as sibling tests).
mock.module("server-only", () => ({}));

let mockDeleteRepoFileChunks = mock(() => Promise.resolve());
let mockEnsureCollection = mock(() => Promise.resolve());
let mockUpsertChunks = mock(() => Promise.resolve());

mock.module("@/lib/qdrant", () => ({
  deleteRepoFileChunks: (...args: unknown[]) => mockDeleteRepoFileChunks(...args),
  ensureCollection: () => mockEnsureCollection(),
  upsertChunks: (...args: unknown[]) => mockUpsertChunks(...args),
}));

mock.module("@/lib/embeddings", () => ({
  createEmbeddings: (texts: string[]) =>
    Promise.resolve(texts.map(() => new Array(3072).fill(0.1))),
}));

mock.module("@/lib/sparse-vector", () => ({
  generateSparseVectors: (texts: string[]) =>
    texts.map(() => ({ indices: [0, 1], values: [0.5, 0.5] })),
}));

let mockGetInstallationToken = mock(() => Promise.resolve("test-token"));
let mockGetRepositoryDetails = mock((..._args: unknown[]): Promise<{ default_branch: string } | null> => Promise.resolve(null));
let mockGhGetFileContent = mock((_installationId: number, _owner: string, _repo: string, _branch: string, filePath: string) => {
  if (filePath === "src/index.ts") return Promise.resolve("export const hello = 'world';\n");
  if (filePath === "src/utils.ts") return Promise.resolve("export function add(a: number, b: number) { return a + b; }\n");
  if (filePath === "README.md") return Promise.resolve("# Test Repo\n\nThis is a test.\n");
  return Promise.resolve(null);
});

mock.module("@/lib/github", () => ({
  getInstallationToken: (...args: unknown[]) => mockGetInstallationToken(...args),
  getFileContent: (...args: unknown[]) => mockGhGetFileContent(...(args as Parameters<typeof mockGhGetFileContent>)),
  getRepositoryDetails: (...args: unknown[]) => mockGetRepositoryDetails(...args),
}));

let mockBbGetFileContent = mock((_org: string, _workspace: string, _slug: string, _branch: string, _filePath: string): Promise<string | null> => Promise.resolve(null));

mock.module("@/lib/bitbucket", () => ({
  getFileContent: (...args: unknown[]) => mockBbGetFileContent(...(args as Parameters<typeof mockBbGetFileContent>)),
  getAccessToken: () => Promise.resolve("bb-token"),
}));

let mockParseOctopusIgnore = mock((_content: string) => ({ ignores: () => false }));

mock.module("@/lib/octopus-ignore", () => ({
  parseOctopusIgnore: (...args: unknown[]) => mockParseOctopusIgnore(...(args as [string])),
}));

// Static imports are hoisted above the mock.module calls, which would load the
// real module graph (and its throwing "server-only" import) first — dynamic
// import after the mocks fixes the ordering (same as ai-router.test.ts).
const { incrementalIndex } = await import("@/lib/indexer");

const indexOwner = { repoId: "repo-1", activeIndexGeneration: null };

// ── Tests ──

describe("incrementalIndex", () => {
  beforeEach(() => {
    mockDeleteRepoFileChunks = mock(() => Promise.resolve());
    mockEnsureCollection = mock(() => Promise.resolve());
    mockUpsertChunks = mock(() => Promise.resolve());
    mockGetInstallationToken = mock(() => Promise.resolve("test-token"));
    mockGetRepositoryDetails = mock(() => Promise.resolve(null));
    mockBbGetFileContent = mock(() => Promise.resolve(null));
    mockGhGetFileContent = mock((_installationId: number, _owner: string, _repo: string, _branch: string, filePath: string) => {
      if (filePath === "src/index.ts") return Promise.resolve("export const hello = 'world';\n");
      if (filePath === "src/utils.ts") return Promise.resolve("export function add(a: number, b: number) { return a + b; }\n");
      if (filePath === "README.md") return Promise.resolve("# Test Repo\n\nThis is a test.\n");
      return Promise.resolve(null);
    });
    mockParseOctopusIgnore = mock((_content: string) => ({ ignores: () => false }));
  });

  it("deletes old chunks and indexes modified files", async () => {
    const result = await incrementalIndex(
      indexOwner,
      "owner/repo",
      "main",
      12345,
      [
        { filename: "src/index.ts", status: "modified" },
        { filename: "src/utils.ts", status: "added" },
      ],
      "github",
    );

    // Should delete chunks for changed files
    expect(mockDeleteRepoFileChunks).toHaveBeenCalledTimes(1);
    const deleteArgs = mockDeleteRepoFileChunks.mock.calls[0];
    expect(deleteArgs[0]).toEqual(indexOwner);
    expect(deleteArgs[1]).toEqual(["src/index.ts", "src/utils.ts"]);

    // Should upsert new chunks
    expect(mockUpsertChunks).toHaveBeenCalledTimes(1);
    const upsertArgs = mockUpsertChunks.mock.calls[0] as [{ payload: { filePath: string; indexedAt: string } }[]];
    const points = upsertArgs[0];
    expect(points.length).toBeGreaterThan(0);

    // All points should have indexedAt metadata
    for (const point of points) {
      expect(point.payload.indexedAt).toBeDefined();
      expect(typeof point.payload.indexedAt).toBe("string");
    }

    expect(result.updatedFiles).toBe(2);
    expect(result.removedFiles).toBe(0);
    expect(result.newVectors).toBeGreaterThan(0);
  });

  it("handles removed files without fetching content", async () => {
    const result = await incrementalIndex(
      indexOwner,
      "owner/repo",
      "main",
      12345,
      [
        { filename: "src/old-file.ts", status: "removed" },
      ],
      "github",
    );

    // Should delete chunks for removed file
    expect(mockDeleteRepoFileChunks).toHaveBeenCalledTimes(1);
    const deleteArgs = mockDeleteRepoFileChunks.mock.calls[0];
    expect(deleteArgs[1]).toEqual(["src/old-file.ts"]);

    // Should NOT upsert anything (removed file = no new content)
    expect(mockUpsertChunks).not.toHaveBeenCalled();

    expect(result.updatedFiles).toBe(0);
    expect(result.removedFiles).toBe(1);
    expect(result.newVectors).toBe(0);
  });

  it("handles mix of added, modified, removed, and renamed files", async () => {
    const result = await incrementalIndex(
      indexOwner,
      "owner/repo",
      "main",
      12345,
      [
        { filename: "src/index.ts", status: "modified" },
        { filename: "src/deleted.ts", status: "removed" },
        { filename: "src/old-name.ts", status: "renamed" },
        { filename: "src/utils.ts", status: "added" },
      ],
      "github",
    );

    // All changed paths should be in the delete call
    const deleteArgs = mockDeleteRepoFileChunks.mock.calls[0];
    const deletedPaths = deleteArgs[1] as string[];
    expect(deletedPaths).toContain("src/index.ts");
    expect(deletedPaths).toContain("src/deleted.ts");
    expect(deletedPaths).toContain("src/old-name.ts");
    expect(deletedPaths).toContain("src/utils.ts");

    // Only "removed" counts as removedFiles; renamed files get re-indexed under their new name
    expect(result.removedFiles).toBe(1); // only "removed"
    expect(result.updatedFiles).toBe(3); // modified + added + renamed (renamed gets re-indexed)
  });

  it("skips non-indexable file types", async () => {
    const result = await incrementalIndex(
      indexOwner,
      "owner/repo",
      "main",
      12345,
      [
        { filename: "image.png", status: "added" },
        { filename: "data.bin", status: "modified" },
      ],
      "github",
    );

    // PNG and BIN are not in CODE_EXTENSIONS, should be skipped
    expect(result.updatedFiles).toBe(0);
    expect(result.newVectors).toBe(0);
  });

  it("returns zero vectors when no files changed", async () => {
    const result = await incrementalIndex(
      indexOwner,
      "owner/repo",
      "main",
      12345,
      [],
      "github",
    );

    expect(mockDeleteRepoFileChunks).not.toHaveBeenCalled();
    expect(mockUpsertChunks).not.toHaveBeenCalled();
    expect(result.updatedFiles).toBe(0);
    expect(result.removedFiles).toBe(0);
    expect(result.newVectors).toBe(0);
  });

  it("continues indexing when one file fetch fails", async () => {
    using warning = spyOn(console, "warn").mockImplementation(() => {});
    // Override getFileContent to fail for one file
    mockGhGetFileContent = mock((_installationId: number, _owner: string, _repo: string, _branch: string, filePath: string) => {
      if (filePath === "src/broken.ts") return Promise.reject(new Error("404 Not Found"));
      if (filePath === "src/utils.ts") return Promise.resolve("export const x = 1;\n");
      return Promise.resolve(null);
    });

    const result = await incrementalIndex(
      indexOwner,
      "owner/repo",
      "main",
      12345,
      [
        { filename: "src/broken.ts", status: "modified" },
        { filename: "src/utils.ts", status: "modified" },
      ],
      "github",
    );

    // Should still index the successful file
    expect(warning.mock.calls).toEqual([["[indexer:incremental] Failed to fetch src/broken.ts, skipping"]]);
    expect(mockGhGetFileContent.mock.calls.map((call) => call[4])).toEqual([".octopusignore", "src/broken.ts", "src/utils.ts"]);
    expect(mockUpsertChunks).toHaveBeenCalledTimes(1);
    expect(result.newVectors).toBeGreaterThan(0);
  });

  it("skips fetched files that exceed MAX_FILE_SIZE bytes", async () => {
    mockGhGetFileContent = mock((_installationId: number, _owner: string, _repo: string, _branch: string, filePath: string) => {
      if (filePath === "src/big.ts") return Promise.resolve("a".repeat(100_001));
      return Promise.resolve(null);
    });

    const result = await incrementalIndex(
      indexOwner,
      "owner/repo",
      "main",
      12345,
      [{ filename: "src/big.ts", status: "modified" }],
      "github",
    );

    expect(mockUpsertChunks).not.toHaveBeenCalled();
    expect(result.newVectors).toBe(0);
  });

  it("stops before touching the index when .octopusignore cannot be read", async () => {
    mockGhGetFileContent = mock(async (...args: Parameters<typeof import("../github").getFileContent>) => {
      const [, , , , filePath, , , , options] = args;
      if (filePath === ".octopusignore" && options?.failOnError) throw new Error("Failed to get GitHub file content: 500");
      if (filePath === "src/secret.ts") return "const key = 'hush';\n";
      return null;
    });

    await expect(
      incrementalIndex(indexOwner, "owner/repo", "main", 12345, [{ filename: "src/secret.ts", status: "modified" }], "github"),
    ).rejects.toThrow("could not read .octopusignore");

    // Nothing is fetched, deleted or embedded without the rules
    expect(mockGhGetFileContent.mock.calls.map((c) => c[4])).toEqual([".octopusignore"]);
    expect(mockDeleteRepoFileChunks).not.toHaveBeenCalled();
    expect(mockUpsertChunks).not.toHaveBeenCalled();
  });

  it("treats a provider's 404 for .octopusignore as a repository without rules", async () => {
    mockBbGetFileContent = mock((_org: string, _workspace: string, _slug: string, _branch: string, filePath: string) =>
      filePath === ".octopusignore"
        ? Promise.reject(Object.assign(new Error("Failed to get Bitbucket file content: 404"), { status: 404 }))
        : Promise.resolve("export const x = 1;\n"),
    );

    const result = await incrementalIndex(indexOwner, "workspace/repo", "main", 0, [{ filename: "src/utils.ts", status: "modified" }], "bitbucket", "org-1");

    expect(result.updatedFiles).toBe(1);
    expect(mockUpsertChunks).toHaveBeenCalledTimes(1);
  });

  it("stops when a provider fails to return .octopusignore for any other reason", async () => {
    mockBbGetFileContent = mock((_org: string, _workspace: string, _slug: string, _branch: string, filePath: string) =>
      filePath === ".octopusignore"
        ? Promise.reject(Object.assign(new Error("Failed to get Bitbucket file content: 500"), { status: 500 }))
        : Promise.resolve("export const x = 1;\n"),
    );

    await expect(
      incrementalIndex(indexOwner, "workspace/repo", "main", 0, [{ filename: "src/utils.ts", status: "modified" }], "bitbucket", "org-1"),
    ).rejects.toThrow("could not read .octopusignore");
    expect(mockUpsertChunks).not.toHaveBeenCalled();
  });

  it("stops before deleting when no changed file can be read and GitHub reports another default branch", async () => {
    // After a rename every read on the stored branch name comes back empty.
    mockGhGetFileContent = mock(() => Promise.resolve(null));
    mockGetRepositoryDetails = mock(() => Promise.resolve({ default_branch: "trunk" }));

    await expect(
      incrementalIndex(indexOwner, "owner/repo", "main", 12345, [
        { filename: "src/index.ts", status: "modified" },
        { filename: "src/utils.ts", status: "modified" },
      ], "github"),
    ).rejects.toThrow("default branch changed");

    expect(mockDeleteRepoFileChunks).not.toHaveBeenCalled();
    expect(mockUpsertChunks).not.toHaveBeenCalled();
  });

  it("still removes entries for unreadable files when the default branch is unchanged", async () => {
    // For example a pull request merged into another branch: its files are not on the default branch.
    mockGhGetFileContent = mock(() => Promise.resolve(null));
    mockGetRepositoryDetails = mock(() => Promise.resolve({ default_branch: "main" }));

    const result = await incrementalIndex(indexOwner, "owner/repo", "main", 12345, [{ filename: "src/gone.ts", status: "modified" }], "github");

    expect(result.newVectors).toBe(0);
    expect(mockDeleteRepoFileChunks).toHaveBeenCalledTimes(1);
    expect((mockDeleteRepoFileChunks.mock.calls[0] as unknown[])[1]).toEqual(["src/gone.ts"]);
  });

  it("does not ask GitHub about the branch when a changed file is readable", async () => {
    mockGetRepositoryDetails = mock(() => Promise.resolve({ default_branch: "trunk" }));

    const result = await incrementalIndex(indexOwner, "owner/repo", "main", 12345, [
      { filename: "src/utils.ts", status: "modified" },
      { filename: "src/missing.ts", status: "modified" },
    ], "github");

    expect(mockGetRepositoryDetails).not.toHaveBeenCalled();
    expect(mockGhGetFileContent.mock.calls.map((call) => call[4])).toEqual([".octopusignore", "src/utils.ts", "src/missing.ts"]);
    expect(mockDeleteRepoFileChunks).toHaveBeenCalledTimes(1);
    const [, readableFileRead, missingFileRead] = mockGhGetFileContent.mock.invocationCallOrder;
    const [deletion] = mockDeleteRepoFileChunks.mock.invocationCallOrder;
    expect(readableFileRead).toBeLessThan(deletion);
    expect(deletion).toBeLessThan(missingFileRead);
    expect(result.newVectors).toBeGreaterThan(0);
  });

  it("honours .octopusignore from the default branch", async () => {
    mockGhGetFileContent = mock((_installationId: number, _owner: string, _repo: string, _branch: string, filePath: string) => {
      if (filePath === ".octopusignore") return Promise.resolve("src/secret.ts\n");
      if (filePath === "src/secret.ts") return Promise.resolve("const key = 'hush';\n");
      if (filePath === "src/utils.ts") return Promise.resolve("export const x = 1;\n");
      return Promise.resolve(null);
    });
    mockParseOctopusIgnore = mock((_content: string) => ({
      ignores: (path: string) => path === "src/secret.ts",
    }));

    const result = await incrementalIndex(
      indexOwner,
      "owner/repo",
      "main",
      12345,
      [
        { filename: "src/secret.ts", status: "modified" },
        { filename: "src/utils.ts", status: "modified" },
      ],
      "github",
    );

    // The ignored path must never be fetched
    const fetchedPaths = mockGhGetFileContent.mock.calls.map((c) => c[4]);
    expect(fetchedPaths).not.toContain("src/secret.ts");

    // Only the non-ignored file is indexed
    const upsertArgs = mockUpsertChunks.mock.calls[0] as [{ payload: { filePath: string } }[]];
    const filePaths = upsertArgs[0].map((p) => p.payload.filePath);
    expect(filePaths).toContain("src/utils.ts");
    expect(filePaths).not.toContain("src/secret.ts");
    expect(result.updatedFiles).toBe(1);
  });

  it("sets correct payload fields on upserted points", async () => {
    await incrementalIndex(
      indexOwner,
      "owner/repo",
      "main",
      12345,
      [{ filename: "src/index.ts", status: "modified" }],
      "github",
    );

    const upsertArgs = mockUpsertChunks.mock.calls[0] as [{ id: string; vector: number[]; payload: Record<string, unknown> }[]];
    const point = upsertArgs[0][0];

    expect(point.id).toBeDefined();
    expect(point.vector).toBeArray();
    expect(point.vector.length).toBe(3072);
    expect(point.payload.repoId).toBe("repo-1");
    expect(point.payload.fullName).toBe("owner/repo");
    expect(point.payload.filePath).toBe("src/index.ts");
    expect(point.payload.language).toBe("ts");
    expect(point.payload.indexedAt).toBeDefined();
    expect(typeof point.payload.startLine).toBe("number");
    expect(typeof point.payload.endLine).toBe("number");
    expect(typeof point.payload.text).toBe("string");
  });
});
