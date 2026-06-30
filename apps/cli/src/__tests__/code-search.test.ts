import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containedPath, extractKeywords, fileReadSearch } from "../lib/code-search";

describe("containedPath (path-traversal guard, lexical)", () => {
  const root = "/tmp/repo";

  it("allows files inside the repo (and the root itself)", () => {
    expect(containedPath(root, "src/a.ts")).toBe(resolve(root, "src/a.ts"));
    expect(containedPath(root, "a.ts")).toBe(resolve(root, "a.ts"));
    expect(containedPath(root, ".")).toBe(resolve(root));
  });

  it("rejects traversal and absolute escapes", () => {
    expect(containedPath(root, "../../etc/passwd")).toBeNull();
    expect(containedPath(root, "../sibling/x")).toBeNull();
    expect(containedPath(root, "/etc/passwd")).toBeNull();
    expect(containedPath(root, "src/../../escape")).toBeNull();
  });
});

describe("containedPath (symlink-escape guard)", () => {
  let base: string;
  let repo: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "octp-cs-"));
    repo = join(base, "repo");
    mkdirSync(repo);
    const secret = join(base, "secret");
    mkdirSync(secret);
    writeFileSync(join(secret, "id_rsa"), "TOPSECRET-KEY-MATERIAL");
    writeFileSync(join(repo, "real.ts"), "const ok = true;\n");
    // An in-repo file symlink and dir symlink that point OUTSIDE the repo.
    symlinkSync(join(secret, "id_rsa"), join(repo, "leak")); // repo/leak -> ../secret/id_rsa
    symlinkSync(secret, join(repo, "dirlink")); // repo/dirlink -> ../secret
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("allows a genuine in-repo file", () => {
    expect(containedPath(repo, "real.ts")).toBe(resolve(repo, "real.ts"));
  });

  it("rejects an in-repo symlink that resolves outside the repo", () => {
    expect(containedPath(repo, "leak")).toBeNull();
    expect(containedPath(repo, "dirlink/id_rsa")).toBeNull();
  });

  it("fileReadSearch refuses to read through an escaping symlink", async () => {
    const res = await fileReadSearch(["leak", "dirlink/id_rsa"], repo);
    expect(res.results).toHaveLength(0);
    expect(res.summary).not.toContain("TOPSECRET");
  });
});

describe("extractKeywords", () => {
  it("drops stop-words; keeps content words, identifiers, and quoted phrases", () => {
    const kw = extractKeywords('where do we validate the "oct_ token" prefix in parseToken');
    expect(kw).toContain("validate");
    expect(kw).toContain("prefix");
    expect(kw).toContain("parseToken"); // camelCase identifier (prioritised)
    expect(kw).toContain("oct_ token"); // quoted phrase
    expect(kw).not.toContain("the");
    expect(kw).not.toContain("do");
    expect(kw.length).toBeLessThanOrEqual(10);
  });
});
