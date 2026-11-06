import { expect, it } from "bun:test";

it.skipIf(!process.env.PLAYWRIGHT_MODULE_PATH)("withholds private live indexing messages in Chrome", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH!);
  const build = await Bun.build({
    entrypoints: [new URL("./fixtures/indexing-privacy-ui.tsx", import.meta.url).pathname], target: "browser",
    plugins: [{ name: "privacy-fixture", setup(builder) {
      const modules: Record<string, string> = {
        "next/navigation": "export function useRouter(){return {refresh(){}}}",
        "@/lib/pubby-client": "export function getPubbyClient(){return {subscribe:()=>window.privacyFixture.channel}}",
      };
      builder.onResolve({ filter: /^(next\/navigation|@\/lib\/pubby-client)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
      builder.onResolve({ filter: /^@\// }, ({ path }) => ({ path: Bun.resolveSync(`./${path.slice(2)}`, new URL("../../", import.meta.url).pathname) }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: modules[path] }));
    } }],
  });
  expect(build.success, build.logs.join("\n")).toBe(true);
  const bundle = await build.outputs[0].text();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    return new URL(request.url).pathname === "/fixture.js" ? new Response(bundle, { headers: { "Content-Type": "text/javascript" } }) : new Response('<div id="root"></div><script type="module" src="/fixture.js"></script>', { headers: { "Content-Type": "text/html" } });
  } });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL });
    const page = await browser.newPage();
    await page.goto(server.url.href);
    await page.getByText("Indexing Logs", { exact: true }).waitFor();
    await page.evaluate(() => {
      const f = (window as unknown as { privacyFixture: { emit: (name: string, data: unknown) => void } }).privacyFixture;
      for (let i = 0; i < 2; i++) f.emit("index-log", { repoId: "repo", message: "Error at /private/secret: synthetic-token", level: "error", timestamp: 42 });
      f.emit("index-log", { repoId: "repo", message: "Processed 5 files, skipped 0", level: "info", timestamp: 43 });
    });
    await page.getByText("Processed 5 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Indexing message withheld for privacy.", { exact: true }).count()).toBe(2);
    expect(await page.getByText(/synthetic-token/).count()).toBe(0);
    await page.getByRole("alert").filter({ hasText: "Indexing messages may include duplicates" }).waitFor();
    await page.evaluate(() => {
      const f = (window as unknown as { privacyFixture: { attempt: string | null; emit: (name: string, data: unknown) => void } }).privacyFixture;
      f.attempt = "current"; f.emit("index-status", { repoId: "repo" });
      f.emit("index-log", { repoId: "repo", indexAttemptId: "current", message: "Error /private/tagged synthetic-token", level: "error", timestamp: 44 });
      f.emit("index-log", { repoId: "repo", indexAttemptId: "current", message: "Processed 8 files, skipped 0", level: "info", timestamp: 45 });
    });
    await page.getByText("Processed 8 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Indexing message withheld for privacy.", { exact: true }).count()).toBe(3);
    expect(await page.getByText(/synthetic-token/).count()).toBe(0);
  } finally {
    await browser?.close();
    server.stop(true);
  }
}, 30000);
