import { describe, it, expect } from "bun:test";
import {
  normalizeRepoConfigFiles,
  DEFAULT_REPO_CONFIG_FILES,
  buildRepoConfigUserBlock,
} from "@/lib/repo-config-shared";

describe("normalizeRepoConfigFiles", () => {
  it("returns defaults when input is not an array", () => {
    expect(normalizeRepoConfigFiles(null)).toEqual([...DEFAULT_REPO_CONFIG_FILES]);
    expect(normalizeRepoConfigFiles(undefined)).toEqual([...DEFAULT_REPO_CONFIG_FILES]);
    expect(normalizeRepoConfigFiles("AGENTS.md")).toEqual([...DEFAULT_REPO_CONFIG_FILES]);
  });

  it("keeps valid filenames in order", () => {
    const result = normalizeRepoConfigFiles(["AGENTS.md", "AJAN.md", ".octopus.md"]);
    expect(result).toEqual(["AGENTS.md", "AJAN.md", ".octopus.md"]);
  });

  it("drops paths with slashes or traversal", () => {
    const result = normalizeRepoConfigFiles([
      "AGENTS.md",
      "docs/AGENTS.md",
      "../etc/passwd",
      "..",
    ]);
    expect(result).toEqual(["AGENTS.md"]);
  });

  it("drops invalid characters", () => {
    const result = normalizeRepoConfigFiles([
      "AGENTS.md",
      "agents and rules.md",
      "agents;rm -rf.md",
      "agents$.md",
    ]);
    expect(result).toEqual(["AGENTS.md"]);
  });

  it("dedupes and caps at 10 entries", () => {
    const input = Array.from({ length: 15 }, (_, i) => `f${i}.md`);
    const result = normalizeRepoConfigFiles([...input, "f0.md"]);
    expect(result.length).toBe(10);
    expect(new Set(result).size).toBe(10);
  });

  it("falls back to defaults when all entries are invalid", () => {
    const result = normalizeRepoConfigFiles(["", "../x", "a/b", null, 5]);
    expect(result).toEqual([...DEFAULT_REPO_CONFIG_FILES]);
  });
});

describe("buildRepoConfigUserBlock", () => {
  it("returns empty string when there is nothing to inject", () => {
    expect(buildRepoConfigUserBlock(null)).toBe("");
  });

  it("wraps extracted rules in a repo_config tag with explicit untrusted framing", () => {
    const block = buildRepoConfigUserBlock({
      source: "AGENTS.md",
      rules: "- Use snake_case\n- Avoid var",
      contentHash: "abc",
      cached: false,
    });
    expect(block).toContain('<repo_config source="AGENTS.md">');
    expect(block).toContain("</repo_config>");
    expect(block).toContain("UNTRUSTED");
    expect(block).toContain("- Use snake_case");
  });

  it("escapes special characters in the source attribute (defense-in-depth)", () => {
    // normalizeRepoConfigFiles forbids these chars upstream, but the rendering
    // function must not be the weak link if a future caller bypasses it.
    const block = buildRepoConfigUserBlock({
      source: 'evil"><script>alert(1)</script>',
      rules: "- noop",
      contentHash: "abc",
      cached: false,
    });
    expect(block).not.toContain('"><script>');
    expect(block).toContain("&quot;");
    expect(block).toContain("&lt;script&gt;");
    expect(block).toContain("</repo_config>"); // closing tag intact, not closed early
  });
});
