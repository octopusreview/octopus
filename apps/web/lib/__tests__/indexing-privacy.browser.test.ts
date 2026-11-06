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
    await page.evaluate(`{
      const f = window.privacyFixture; f.attempt = 'owner-a';
      f.logs = [0, 1].map(() => ({indexAttemptId:'owner-a',message:'Processed 21 files, skipped 0',level:'info',timestamp:1}));
      f.emit('index-status', {repoId:'repo'});
    }`);
    await page.waitForFunction("document.body.textContent.split('Processed 21 files, skipped 0').length === 3");
    const ownershipWarning = page.getByRole("alert").filter({ hasText: "may belong to an earlier attempt" });
    expect(await ownershipWarning.count()).toBe(0);
    await page.evaluate(`{
      const f = window.privacyFixture; f.attempt = 'owner-b'; f.fail = true; f.delay = 250;
      f.logs = [{indexAttemptId:'owner-b',message:'Processed 22 files, skipped 0',level:'info',timestamp:2}];
      f.emit('index-status', {repoId:'repo'});
      f.emit('index-log', {repoId:'repo',indexAttemptId:'owner-a',message:'Error /private/status synthetic-secret',level:'error',timestamp:3});
    }`);
    await ownershipWarning.waitFor();
    expect(await page.getByText("Processed 21 files, skipped 0", { exact: true }).count()).toBe(2);
    await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).waitFor();
    expect(await ownershipWarning.count()).toBe(1);
    expect(await page.getByText(/synthetic-secret|\/private\/status/).count()).toBe(0);
    await page.evaluate("window.privacyFixture.fail=false; window.privacyFixture.delay=0");
    await page.getByRole("button", { name: "Retry loading logs" }).click();
    await page.getByText("Processed 22 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Processed 21 files, skipped 0", { exact: true }).count()).toBe(0);
    expect(await ownershipWarning.count()).toBe(0);
    expect(await page.getByText("Indexing message withheld for privacy.", { exact: true }).count()).toBe(0);
    await page.evaluate(`{
      const f=window.privacyFixture; f.attempt='owner-c'; f.delay=250; f.logs=[];
      f.emit('index-log',{repoId:'repo',indexAttemptId:'owner-c',message:'Processed 23 files, skipped 0',level:'info',timestamp:4});
    }`);
    await ownershipWarning.waitFor();
    expect(await page.getByText("Processed 22 files, skipped 0", { exact: true }).count()).toBe(1);
    await page.getByText("Processed 23 files, skipped 0", { exact: true }).waitFor();
    expect(await ownershipWarning.count()).toBe(0);
    expect(await page.getByText("Processed 22 files, skipped 0", { exact: true }).count()).toBe(0);
    await page.evaluate(`{
      const f=window.privacyFixture; f.delay=0;
      f.emit('index-log',{repoId:'repo',message:'Error /private/live synthetic-secret',level:'error',timestamp:5});
      f.emit('index-log',{repoId:'repo',message:'Error /private/live synthetic-secret',level:'error',timestamp:5});
      f.emit('index-status',{repoId:'repo'});
    }`);
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    await page.waitForFunction("document.body.textContent.split('Indexing message withheld for privacy.').length === 3");
    expect(await page.getByText(/synthetic-secret|\/private\/live/).count()).toBe(0);
    await page.evaluate(`{
      const f=window.privacyFixture; f.logs=[{indexAttemptId:'owner-c',message:'Processed 24 files, skipped 0',level:'info',timestamp:6}];
      f.setScope('other-repo');
    }`);
    await page.getByText("Processed 24 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Indexing message withheld for privacy.", { exact: true }).count()).toBe(0);
    expect(await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).count()).toBe(0);
    expect(await ownershipWarning.count()).toBe(0);
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
    await page.evaluate(() => {
      const f = (window as unknown as { privacyFixture: { fail: boolean; emit: (name: string, data: unknown) => void } }).privacyFixture;
      f.fail = true;
      f.emit("index-status", { repoId: "repo" });
    });
    await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).waitFor();
    await page.evaluate(() => {
      const f = (window as unknown as { privacyFixture: { emit: (name: string, data: unknown) => void } }).privacyFixture;
      f.emit("index-log", { repoId: "repo", message: "Processed 12 files, skipped 0", level: "info", timestamp: 47 });
      f.emit("index-log", { repoId: "repo", message: "Error /private/outage synthetic-token", level: "error", timestamp: 46 });
      f.emit("index-log", { repoId: "repo", indexAttemptId: "stale", message: "Processed 13 files, skipped 0", level: "info", timestamp: 48 });
    });
    await page.getByText("Processed 12 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Indexing message withheld for privacy.", { exact: true }).count()).toBe(4);
    expect(await page.getByText("Processed 13 files, skipped 0", { exact: true }).count()).toBe(0);
    expect(await page.getByText(/synthetic-token|\/private\/outage/).count()).toBe(0);
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    await page.evaluate(() => { (window as unknown as { privacyFixture: { fail: boolean } }).privacyFixture.fail = false; });
    await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).waitFor({ state: "hidden" });
    expect(await page.getByText("Processed 12 files, skipped 0", { exact: true }).count()).toBe(1);
    expect(await page.getByText("Indexing message withheld for privacy.", { exact: true }).count()).toBe(4);
    expect(await page.getByText("Processed 13 files, skipped 0", { exact: true }).count()).toBe(0);
    await page.goto(server.url.href);
    await page.getByText("Indexing Logs", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.privacyFixture; f.attempt='bulk-owner';
      f.logs=[{indexAttemptId:'bulk-owner',message:'Local indexing started',level:'info',timestamp:0}];
      f.emit('index-status',{repoId:'repo'});
    }`);
    await page.getByText("Local indexing started", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.privacyFixture;
      for(let i=2100;i>=1;i--) f.emit('index-log',{repoId:'repo',indexAttemptId:'bulk-owner',message:'Processed '+i+' files, skipped 0',level:'info',timestamp:i});
      for(let i=0;i<2;i++) f.emit('index-log',{repoId:'repo',indexAttemptId:'bulk-owner',message:'Error /private/bulk synthetic-token',level:'error',timestamp:2099.5});
    }`);
    const rows = page.getByRole("list", { name: "Indexing messages" }).getByRole("listitem");
    await page.getByText("Processed 2100 files, skipped 0", { exact: true }).waitFor();
    expect(await rows.count()).toBe(200);
    expect(await page.getByText("Indexing message withheld for privacy.", { exact: true }).count()).toBe(2);
    expect(await page.getByText(/synthetic-token|\/private\/bulk/).count()).toBe(0);
    expect(await rows.filter({ hasText: "Processed 2100 files, skipped 0" }).locator("svg.animate-spin").count()).toBe(1);
    await page.getByRole("button", { name: "Show older messages" }).click();
    const olderWindow = await rows.allTextContents();
    await page.evaluate(`{
      const f=window.privacyFixture;
      f.emit('index-log',{repoId:'repo',indexAttemptId:'bulk-owner',message:'Processed 2102 files, skipped 0',level:'info',timestamp:2102});
      for(let i=0;i<2;i++) f.emit('index-log',{repoId:'repo',message:'Error /private/new synthetic-token',level:'error',timestamp:2103});
      f.emit('index-log',{repoId:'repo',indexAttemptId:'bulk-owner',message:'Processed 7777 files, skipped 0',level:'info',timestamp:1750.2});
      for(let i=0;i<2;i++) f.emit('index-log',{repoId:'repo',message:'Processed 8888 files, skipped 0',level:'info',timestamp:1750.3});
    }`);
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    expect(await rows.allTextContents()).toEqual(olderWindow);
    await page.getByRole("button", { name: "Refresh this page" }).click();
    await page.getByText("Processed 7777 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Processed 8888 files, skipped 0", { exact: true }).count()).toBe(2);
    while (await page.getByRole("button", { name: "Show newer messages" }).count()) {
      await page.getByRole("button", { name: "Show newer messages" }).click();
    }
    const pages: string[][] = [];
    while (true) {
      const contents = await rows.allTextContents();
      expect(contents.length).toBeLessThanOrEqual(200);
      pages.unshift(contents);
      const older = page.getByRole("button", { name: "Show older messages" });
      if (!await older.count()) break;
      await older.click();
    }
    const messages = pages.flat();
    expect(messages.filter((message) => message === "Indexing message withheld for privacy.").length).toBe(4);
    const numbers = messages.flatMap((message) => {
      const match = /^Processed (\d+) files, skipped 0$/.exec(message);
      return match ? [Number(match[1])] : [];
    });
    expect(numbers).toEqual([...Array.from({ length: 1750 }, (_, i) => i + 1), 7777, 8888, 8888, ...Array.from({ length: 350 }, (_, i) => i + 1751), 2102]);
    expect(await page.getByText("Processed 1 files, skipped 0", { exact: true }).count()).toBe(1);
    expect(await rows.locator("svg.animate-spin").count()).toBe(0);
    await page.evaluate(`{
      const f=window.privacyFixture; f.attempt='replacement-owner';
      f.logs=[{indexAttemptId:'replacement-owner',message:'Processed 5000 files, skipped 0',level:'info',timestamp:10000}];
      f.emit('index-status',{repoId:'repo'});
    }`);
    await page.getByText("Processed 5000 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Show newer messages" }).count()).toBe(0);
    await page.evaluate(`{
      const f=window.privacyFixture;
      for(let i=1;i<=250;i++) f.emit('index-log',{repoId:'repo',indexAttemptId:'replacement-owner',message:'Processed '+(5000+i)+' files, skipped 0',level:'info',timestamp:10000+i});
    }`);
    await page.getByText("Processed 5250 files, skipped 0", { exact: true }).waitFor();
    expect(await rows.count()).toBe(200);
    expect(await page.getByText("Processed 5001 files, skipped 0", { exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Show newer messages" }).count()).toBe(0);
    expect(await page.getByText(/synthetic-token|\/private\//).count()).toBe(0);
    await page.evaluate(`{
      const f=window.privacyFixture; f.logs=[{indexAttemptId:'replacement-owner',message:'Local indexing complete',level:'success',timestamp:1}];
      f.setScope('new-repo');
    }`);
    await page.getByText("Local indexing complete", { exact: true }).waitFor();
    expect(await rows.count()).toBe(1);
    expect(await page.getByRole("button", { name: "Show older messages" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Show newer messages" }).count()).toBe(0);

  } finally {
    await browser?.close();
    server.stop(true);
  }
}, 120000);
