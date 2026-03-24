import { describe, it, expect } from "bun:test";
import { parseOctopusIgnore, filterDiff, detectBadCommits } from "@/lib/octopus-ignore";

const SAMPLE_DIFF = `diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { app } from "./app";
+import { logger } from "./logger";

 app.listen(3000);
diff --git a/tests/index.test.ts b/tests/index.test.ts
index 111222..333444 100644
--- a/tests/index.test.ts
+++ b/tests/index.test.ts
@@ -1,3 +1,5 @@
 import { describe, it } from "bun:test";
+import { app } from "../src/app";
+
 describe("app", () => {
diff --git a/docs/README.md b/docs/README.md
index aaa111..bbb222 100644
--- a/docs/README.md
+++ b/docs/README.md
@@ -1 +1,2 @@
 # My App
+Some docs here
`;

describe("parseOctopusIgnore", () => {
  it("returns an ignore instance", () => {
    const ig = parseOctopusIgnore("*.log\nnode_modules/");
    expect(ig).toBeDefined();
    expect(typeof ig.ignores).toBe("function");
  });

  it("ignores matching paths", () => {
    const ig = parseOctopusIgnore("*.log\ndist/\n*.min.js");
    expect(ig.ignores("app.log")).toBe(true);
    expect(ig.ignores("dist/bundle.js")).toBe(true);
    expect(ig.ignores("app.min.js")).toBe(true);
  });

  it("does not ignore non-matching paths", () => {
    const ig = parseOctopusIgnore("*.log\ndist/");
    expect(ig.ignores("src/index.ts")).toBe(false);
    expect(ig.ignores("package.json")).toBe(false);
  });

  it("handles comments and empty lines", () => {
    const ig = parseOctopusIgnore("# This is a comment\n\n*.log\n\n# Another comment\ndist/");
    expect(ig.ignores("app.log")).toBe(true);
    expect(ig.ignores("dist/file.js")).toBe(true);
    expect(ig.ignores("src/index.ts")).toBe(false);
  });

  it("handles negation patterns", () => {
    const ig = parseOctopusIgnore("*.js\n!important.js");
    expect(ig.ignores("bundle.js")).toBe(true);
    expect(ig.ignores("important.js")).toBe(false);
  });
});

describe("filterDiff", () => {
  it("removes diff sections for ignored files", () => {
    const ig = parseOctopusIgnore("docs/");
    const filtered = filterDiff(SAMPLE_DIFF, ig);
    expect(filtered).toContain("src/index.ts");
    expect(filtered).toContain("tests/index.test.ts");
    expect(filtered).not.toContain("docs/README.md");
  });

  it("keeps all sections when nothing is ignored", () => {
    const ig = parseOctopusIgnore("*.log");
    const filtered = filterDiff(SAMPLE_DIFF, ig);
    expect(filtered).toContain("src/index.ts");
    expect(filtered).toContain("tests/index.test.ts");
    expect(filtered).toContain("docs/README.md");
  });

  it("removes all sections when everything is ignored", () => {
    const ig = parseOctopusIgnore("src/\ntests/\ndocs/");
    const filtered = filterDiff(SAMPLE_DIFF, ig);
    expect(filtered.trim()).toBe("");
  });

  it("handles empty diff", () => {
    const ig = parseOctopusIgnore("*.log");
    const filtered = filterDiff("", ig);
    expect(filtered).toBe("");
  });

  it("handles wildcard patterns", () => {
    const ig = parseOctopusIgnore("*.test.ts");
    const filtered = filterDiff(SAMPLE_DIFF, ig);
    expect(filtered).toContain("src/index.ts");
    expect(filtered).not.toContain("tests/index.test.ts");
    expect(filtered).toContain("docs/README.md");
  });
});

describe("detectBadCommits", () => {
  it("detects node_modules in diff", () => {
    const diff = `diff --git a/node_modules/lodash/index.js b/node_modules/lodash/index.js
+++ b/node_modules/lodash/index.js
@@ -0,0 +1 @@
+module.exports = {};`;
    const bad = detectBadCommits(diff);
    expect(bad).toContain("node_modules/lodash/index.js");
  });

  it("detects .next directory in diff", () => {
    const diff = `diff --git a/.next/build.js b/.next/build.js
+++ b/.next/build.js
@@ -0,0 +1 @@
+console.log("build");`;
    const bad = detectBadCommits(diff);
    expect(bad.length).toBe(1);
    expect(bad[0]).toContain(".next/");
  });

  it("detects dist directory in diff", () => {
    const diff = `diff --git a/dist/bundle.js b/dist/bundle.js
+++ b/dist/bundle.js
@@ -0,0 +1 @@
+var a=1;`;
    const bad = detectBadCommits(diff);
    expect(bad).toContain("dist/bundle.js");
  });

  it("detects __pycache__ in diff", () => {
    const diff = `diff --git a/__pycache__/app.cpython-311.pyc b/__pycache__/app.cpython-311.pyc
+++ b/__pycache__/app.cpython-311.pyc`;
    const bad = detectBadCommits(diff);
    expect(bad.length).toBe(1);
  });

  it("detects multiple bad directories", () => {
    const diff = `diff --git a/node_modules/x/y.js b/node_modules/x/y.js
--- a/node_modules/x/y.js
+++ b/node_modules/x/y.js
+module.exports = {}
diff --git a/dist/main.js b/dist/main.js
--- a/dist/main.js
+++ b/dist/main.js
+console.log("built")
diff --git a/coverage/lcov.info b/coverage/lcov.info
--- a/coverage/lcov.info
+++ b/coverage/lcov.info
+TN:`;
    const bad = detectBadCommits(diff);
    // Each diff section targets a known bad directory: node_modules, dist, coverage
    expect(bad.length).toBe(3);
  });

  it("returns empty array for clean diff", () => {
    const bad = detectBadCommits(SAMPLE_DIFF);
    expect(bad).toEqual([]);
  });

  it("returns empty array for empty diff", () => {
    const bad = detectBadCommits("");
    expect(bad).toEqual([]);
  });

  it("detects vendor directory", () => {
    const diff = `diff --git a/vendor/lib/pkg.go b/vendor/lib/pkg.go
+++ b/vendor/lib/pkg.go`;
    const bad = detectBadCommits(diff);
    expect(bad.length).toBe(1);
  });
});
