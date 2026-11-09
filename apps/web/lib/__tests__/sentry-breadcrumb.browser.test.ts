import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runBrowserFixture(fixture: string, mode = "static") {
  const marker = crypto.randomUUID();
  const job = crypto.randomUUID();
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, `fixtures/${fixture}`)], target: "browser",
    define: { "process.env": "{}" } });
  expect(build.success, build.logs.join("\n")).toBe(true);
  const bundle = await build.outputs[0].text();
  const directory = await mkdtemp(join(tmpdir(), "octopus-breadcrumb-browser-"));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js") return new Response(bundle, { headers: { "Content-Type": "text/javascript" } });
    if (path === "/receiver") return new Response("ok");
    return new Response(`<pre id="result">pending</pre><script>window.process={env:{}};window.syntheticMarker=${JSON.stringify(marker)};window.syntheticJob=${JSON.stringify(job)};window.syntheticMode=${JSON.stringify(mode)};addEventListener('error',e=>document.getElementById('result').textContent='error:'+e.message);addEventListener('unhandledrejection',e=>document.getElementById('result').textContent='error:'+String(e.reason))</script><script type="module" src="/fixture.js"></script>`,
      { headers: { "Content-Type": "text/html" } });
  } });
  try {
    const child = Bun.spawn([process.env.OCTOPUS_TEST_CHROME_PATH!, "--headless=new", "--disable-gpu", "--disable-background-networking",
      "--no-first-run", `--user-data-dir=${directory}`, "--virtual-time-budget=10000", "--dump-dom", server.url.href],
    { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, stderr).toBe(0);
      expect(stdout, stderr).toContain('<pre id="result">pass</pre>');
    } finally { clearTimeout(timeout); }
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}

it.skipIf(!process.env.OCTOPUS_TEST_CHROME_PATH)("sanitizes an automatic browser fetch breadcrumb", async () => {
  await runBrowserFixture("sentry-breadcrumb-browser.ts");
}, 45_000);

for (const mode of ["static", "stream"]) {
  it.skipIf(!process.env.OCTOPUS_TEST_CHROME_PATH)(`sanitizes a browser ${mode} trace envelope`, async () => {
    await runBrowserFixture("sentry-trace-envelope-browser.ts", mode);
  }, 45_000);
}
