import { afterAll, beforeAll, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The script is run as it runs in the workflow, against a stand-in for the blog API.
const posts = [
  { id: "p1", slug: "needs-fix", title: "A", excerpt: null, content: "Octopus is open source.", audioUrl: "https://cdn.test/blog-audio/needs-fix.mp3?v=1" },
  { id: "p2", slug: "fixed-earlier", title: "B", excerpt: null, content: "Octopus is source-available.", audioUrl: "https://cdn.test/blog-audio/fixed-earlier.mp3?v=1" },
  { id: "p3", slug: "no-recording", title: "C", excerpt: null, content: "Octopus is source-available.", audioUrl: null },
  { id: "p4", slug: "not-in-the-file", title: "D", excerpt: null, content: "Unrelated.", audioUrl: "https://cdn.test/blog-audio/not-in-the-file.mp3?v=1" },
];
const edits = ["needs-fix", "fixed-earlier", "no-recording"].map((slug) => ({
  slug,
  before: "Octopus is open source.",
  after: "Octopus is source-available.",
}));

let patches: unknown[] = [];
let server: ReturnType<typeof Bun.serve>;
let dir: string;
let file: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "PATCH") {
        patches.push(await req.json());
        return Response.json({ success: true });
      }
      return Response.json({ posts, pagination: { totalPages: 1 } });
    },
  });
  dir = mkdtempSync(join(tmpdir(), "blog-edits-"));
  file = join(dir, "edits.json");
  writeFileSync(file, JSON.stringify(edits));
});
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  patches = [];
});

async function run(...flags: string[]) {
  const proc = Bun.spawn([process.execPath, "run", join(import.meta.dir, "..", "apply-blog-edits.ts"), file, ...flags], {
    env: { ...process.env, BLOG_API_TOKEN: "test-token", OCTOPUS_API_URL: `http://127.0.0.1:${server.port}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { out, code };
}

it("with --clear-audio, removes the recording of every post in the file that has one, changed now or earlier", async () => {
  const { code } = await run("--apply", "--clear-audio");
  expect(code).toBe(0);
  expect(patches).toEqual([
    { id: "p1", content: "Octopus is source-available.", audioUrl: null },
    { id: "p2", audioUrl: null },
  ]);
});

it("without the flag, saves the text and leaves every recording alone", async () => {
  const { code } = await run("--apply");
  expect(code).toBe(0);
  expect(patches).toEqual([{ id: "p1", content: "Octopus is source-available." }]);
});

it("a dry run with --clear-audio saves nothing and says how many posts it would touch", async () => {
  const { out, code } = await run("--clear-audio");
  expect(code).toBe(0);
  expect(patches).toEqual([]);
  expect(out).toContain("Dry run: 2 post(s) would be updated.");
});
