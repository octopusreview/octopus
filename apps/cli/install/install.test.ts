import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * Release-lookup tests for the native installers (install.sh / install.ps1).
 *
 * The scripts resolve "latest octp release" from the GitHub releases API.
 * Platform releases (v1.0.x) are cut far more often than octp releases, so
 * the newest octp-v* tag routinely sits beyond the first page — a single
 * page-limited request finds nothing (#775). These tests point the scripts at
 * a local fixture API (OCTOPUS_INSTALL_API) and run them in resolve-only mode
 * (OCTOPUS_INSTALL_RESOLVE_ONLY=1) so no binary is downloaded.
 */

const INSTALL_DIR = import.meta.dir;
const REPO = "octopusreview/octopus";

type Release = { tag_name: string; draft: boolean; prerelease: boolean };

// Mimic GitHub's field order: tag_name/draft/prerelease precede `assets`, which
// is what lets the bash parser split objects on `},{` safely.
function release(tag_name: string, opts: Partial<Release> = {}) {
  return {
    url: `https://api.github.com/repos/${REPO}/releases/1`,
    tag_name,
    name: tag_name,
    draft: opts.draft ?? false,
    prerelease: opts.prerelease ?? false,
    assets: [
      { name: "octp-linux-x64", browser_download_url: "https://example.invalid/a" },
      { name: "octp-darwin-arm64", browser_download_url: "https://example.invalid/b" },
    ],
    body: "notes, with a fake \"tag_name\": \"octp-v9.9.9\" inside a string",
  };
}

const platform = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => release(`v1.0.${from - i}`));

// Page 1: 100 platform releases, no octp. Page 2: more platform releases, then a
// draft and a prerelease octp (must be skipped), then the real latest octp.
const PAGES_WITH_OCTP_ON_PAGE_2 = [
  platform(300, 100),
  [
    ...platform(200, 30),
    release("octp-v0.3.0", { draft: true }),
    release("octp-v0.2.1-rc.1", { prerelease: true }),
    release("octp-v0.2.0"),
    release("octp-v0.1.0"),
  ],
];
const PAGES_WITHOUT_OCTP = [platform(300, 100), platform(200, 100), platform(100, 50)];

let server: ReturnType<typeof Bun.serve>;
let pages: unknown[][] = PAGES_WITH_OCTP_ON_PAGE_2;
let requests: { url: string; authorization: string | null }[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      requests.push({ url: url.pathname + url.search, authorization: req.headers.get("authorization") });
      if (url.pathname !== `/repos/${REPO}/releases`) return new Response("not found", { status: 404 });
      const page = Number(url.searchParams.get("page") ?? "1");
      // api.github.com pretty-prints (2-space indent, one field per line); an
      // exhausted page is "[\n\n]". Serve the same shape so the bash parser's
      // whitespace handling is exercised, not just compact JSON.
      return new Response(JSON.stringify(pages[page - 1] ?? [], null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    },
  });
});
afterAll(() => server.stop(true));

async function run(cmd: string[], extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(cmd, {
    env: {
      ...process.env,
      OCTOPUS_INSTALL_API: `http://127.0.0.1:${server.port}`,
      OCTOPUS_INSTALL_REPO: REPO,
      OCTOPUS_INSTALL_RESOLVE_ONLY: "1",
      // Isolate from the developer's shell: a pinned tag would skip the lookup,
      // a real token would be sent to the fixture, and install.ps1 derives its
      // default dir from USERPROFILE, which does not exist on Linux/macOS.
      OCTOPUS_INSTALL_TAG: "",
      GITHUB_TOKEN: "",
      OCTOPUS_INSTALL_DIR: join(import.meta.dir, ".test-install-dir"),
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const SH = ["bash", join(INSTALL_DIR, "install.sh")];
const PS1 = ["pwsh", "-NoProfile", "-File", join(INSTALL_DIR, "install.ps1")];
const hasPwsh = Bun.which("pwsh") !== null;
// pwsh cold-starts in several seconds on CI runners; bun's default per-test timeout is 5 s.
const PWSH_TIMEOUT_MS = 60_000;

describe("install.sh release lookup", () => {
  test("finds the latest non-draft, non-prerelease octp release beyond the first page", async () => {
    pages = PAGES_WITH_OCTP_ON_PAGE_2;
    requests = [];
    const r = await run(SH);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Latest release: octp-v0.2.0");
    expect(requests.map((q) => q.url)).toEqual([
      `/repos/${REPO}/releases?per_page=100&page=1`,
      `/repos/${REPO}/releases?per_page=100&page=2`,
    ]);
  });

  test("fails clearly when no octp release exists on any page", async () => {
    pages = PAGES_WITHOUT_OCTP;
    requests = [];
    const r = await run(SH);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("could not find any non-prerelease octp-v*");
    // Walked every page, then stopped on the first empty one.
    expect(requests.length).toBe(PAGES_WITHOUT_OCTP.length + 1);
  });

  test("sends a bearer token to the API when GITHUB_TOKEN is set", async () => {
    pages = PAGES_WITH_OCTP_ON_PAGE_2;
    requests = [];
    const r = await run(SH, { GITHUB_TOKEN: "test-token" });
    expect(r.code).toBe(0);
    expect(requests[0]?.authorization).toBe("Bearer test-token");
  });
});

describe.skipIf(!hasPwsh)("install.ps1 release lookup", () => {
  test("finds the latest non-draft, non-prerelease octp release beyond the first page", async () => {
    pages = PAGES_WITH_OCTP_ON_PAGE_2;
    requests = [];
    const r = await run(PS1);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Latest release: octp-v0.2.0");
    expect(requests.map((q) => q.url)).toEqual([
      `/repos/${REPO}/releases?per_page=100&page=1`,
      `/repos/${REPO}/releases?per_page=100&page=2`,
    ]);
  }, PWSH_TIMEOUT_MS);

  test("fails clearly when no octp release exists on any page", async () => {
    pages = PAGES_WITHOUT_OCTP;
    requests = [];
    const r = await run(PS1);
    expect(r.code).toBe(1);
    expect(r.stderr + r.stdout).toContain("Could not find any non-prerelease octp-v*");
  }, PWSH_TIMEOUT_MS);
});
