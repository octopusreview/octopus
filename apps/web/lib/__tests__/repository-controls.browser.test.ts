import { fileURLToPath } from "node:url";
import { expect, it } from "bun:test";

type FixtureWindow = Window & { repositoryFixture: {
  logDelay: number; logAttempt: string | null; indexAttemptId: string | null;
  logs: Array<{ indexAttemptId?: string; message: string; level: string; timestamp: number }>;
  repo: { id: string }; emit: (event: string, data: { repoId: string }) => void;
} };

// Real React controls in an isolated browser, with only local action/realtime
// fixtures. No provider requests, production authentication or paid reviews.
it.skipIf(!process.env.PLAYWRIGHT_MODULE_PATH)("recovers repository controls after rejected actions and failed indexing", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH!);
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./fixtures/repository-controls-ui.tsx", import.meta.url))], target: "browser",
    plugins: [{ name: "isolated-repository-controls", setup(builder) {
      const modules: Record<string, string> = {
        "next/navigation": `export function useRouter(){return {refresh:()=>window.repositoryFixture.refresh(),push:()=>{}};} export function useSearchParams(){return new URLSearchParams();}`,
        "@/components/link": `export default function Link(props){return window.repositoryFixture.React.createElement('a',props);}`,
        "@/components/chat-provider": `export function useChat(){return {openWithRepoContext(){}};}`,
        "@/components/mermaid-diagram": `export function MermaidDiagram(){return null;}`,
        "@/lib/pubby-client": `export function getPubbyClient(){return {subscribe:()=>window.repositoryFixture.channel};}`,
        // This fixture uses distinct synthetic labels to test attribution; privacy has separate browser coverage.
        "@/lib/index-log-safety": `export const WITHHELD_INDEX_LOG="Indexing message withheld for privacy."; export function safeIndexLogMessage(message){return message;}`,
        "../actions": `
          export async function indexRepository(){const f=window.repositoryFixture;f.indexCalls++;if(f.indexDelay)await new Promise(resolve=>setTimeout(resolve,f.indexDelay));if(f.indexError)return {error:f.indexError};f.logs=[];f.repo.indexStatus=f.fastComplete?'indexed':'indexing';f.emit('index-status',{repoId:f.repo.id,status:f.repo.indexStatus});return {};}
          export async function cancelIndexing(){const f=window.repositoryFixture;if(f.cancelError)return {error:f.cancelError};f.repo.indexStatus='pending';f.emit('index-status',{repoId:f.repo.id,status:'cancelled'});return {};}
          export async function syncRepos(){const f=window.repositoryFixture;return f.syncError?{synced:0,removed:0,error:f.syncError}:{synced:1,removed:0};}`,
        "./actions": `
          export async function toggleAutoReview(_,checked){const f=window.repositoryFixture;f.toggleCalls++;if(f.toggleError)return {error:f.toggleError};f.repo.autoReview=checked;return {};}
          export async function getRepoDetail(){return {contributors:[],summary:null,purpose:null,analysis:null,pullRequests:[]};}
          export async function analyzeRepository(){return {};}
          export async function cancelAnalysis(){return {};}
          export async function toggleFavoriteRepository(){return {};}
          export async function deletePullRequestReview(){return {};}
          export async function cancelPullRequestReview(){return {};}
          export async function updateRepoModels(){return {};}
          export async function transferRepository(){return {};}
          export async function removeRepository(){return {};}
          export async function restoreRepository(){return {};}
          export async function updateReviewConfig(){return {};}`,
      };
      modules["@/app/(app)/actions"] = modules["../actions"];
      builder.onResolve({ filter: /^(next\/navigation|@\/components\/(link|chat-provider|mermaid-diagram)|@\/lib\/pubby-client|\.\.?\/actions)$/ }, ({ path }) => ({ path, namespace: "repository-fixture" }));
      builder.onResolve({ filter: /^@\// }, ({ path }) => modules[path] ? { path, namespace: "repository-fixture" } : { path: Bun.resolveSync(`./${path.slice(2)}`, fileURLToPath(new URL("../../", import.meta.url))) });
      builder.onLoad({ filter: /.*/, namespace: "repository-fixture" }, ({ path }) => ({ loader: "js", contents: modules[path] }));
    }}],
  });
  expect(build.success, build.logs.join("\n")).toBe(true);
  const bundle = await build.outputs[0].text();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    return new URL(request.url).pathname === "/fixture.js"
      ? new Response(bundle, { headers: { "Content-Type": "text/javascript" } })
      : new Response('<html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  } });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.route("**/*", (route: { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> }) => {
      if (new URL(route.request().url()).hostname !== "127.0.0.1") {
        externalRequests.push(route.request().url()); return route.abort();
      }
      return route.continue();
    });
    for (const [owner, buffered, timestamp] of [[null, false, 200], [null, true, 201], ["chrome-exact", false, 202], ["chrome-buffered", true, 203]] as const) {
      await page.goto(new URL("?tagged-delay=1", server.url).href);
      await page.waitForFunction("window.repositoryFixture.logFetches > 0");
      const message = `Processed ${timestamp+2000} files, skipped 0`;
      await page.evaluate(({ id, value, time, delay }: { id: string | null; value: string; time: number; delay: number }) => {
        const f = (window as FixtureWindow).repositoryFixture;
        f.logDelay = delay; f.logAttempt = id; f.indexAttemptId = id ?? "legacy-exact";
        f.logs = [{ ...(id ? { indexAttemptId: id } : {}), message: value, level: "warning", timestamp: time }];
        f.emit("index-status", { repoId: f.repo.id });
      }, { id: owner, value: message, time: timestamp, delay: buffered ? 250 : 0 });
      if (!buffered) await page.getByText(message, { exact: true }).waitFor();
      await page.evaluate(({ id, value, time }: { id: string | null; value: string; time: number }) => {
        const f = (window as FixtureWindow).repositoryFixture;
        const live = { repoId: f.repo.id, ...(id ? { indexAttemptId: id } : {}), message: value, level: "warning", timestamp: time };
        f.emit("index-log", live); f.emit("index-log", live);
      }, { id: owner, value: message, time: timestamp });
      await page.waitForFunction((value: string) => document.body.textContent?.split(value).length === 4, message);
      await page.getByRole("alert").filter({ hasText: "Indexing messages may include duplicates" }).waitFor();
      await page.evaluate(`{
        const f=window.repositoryFixture; f.logDelay=100;
        f.logs=[...f.logs,{...(f.logAttempt?{indexAttemptId:f.logAttempt}:{}),message:'Processed 500013 files, skipped 0',level:'info',timestamp:300}];
        f.emit('index-status',{repoId:f.repo.id});
        f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'stale-tagged',message:'Processed 500038 files, skipped 0',level:'warning',timestamp:301});
      }`);
      await page.getByText("Processed 500013 files, skipped 0", { exact: true }).waitFor();
      expect(await page.getByText(message, { exact: true }).count()).toBe(3);
      expect(await page.getByText("Processed 500038 files, skipped 0", { exact: true }).count()).toBe(0);
    }
    await page.goto(new URL("?tagged-delay=1", server.url).href);
    await page.waitForFunction("window.repositoryFixture.logFetches > 0");
    for (const owner of [null, "browser-owner"]) {
      await page.evaluate((id: string | null) => {
        const f = (window as FixtureWindow).repositoryFixture; f.logDelay = 0; f.logAttempt = id; f.indexAttemptId = id ?? "legacy-a";
        f.logs = [0, 1].map(() => ({ ...(id ? { indexAttemptId: id } : {}), message: "Indexing message withheld for privacy.", level: "error", timestamp: 42 }));
        f.emit("index-status", { repoId: f.repo.id });
      }, owner);
      await page.waitForFunction(`document.body.textContent.split('Indexing message withheld for privacy.').length === 3`);
      await page.evaluate(`{
        const f=window.repositoryFixture; f.logs=[...f.logs,{...(f.logAttempt?{indexAttemptId:f.logAttempt}:{}),message:'Processed 500007 files, skipped 0',level:'info',timestamp:43}];
        f.emit('index-status',{repoId:f.repo.id});
      }`);
      await page.getByText("Processed 500007 files, skipped 0", { exact: true }).waitFor();
      expect(await page.getByText("Indexing message withheld for privacy.", { exact: true }).count()).toBe(2);
      await page.evaluate(`{
        const f=window.repositoryFixture; f.logAttempt=f.logAttempt?'other-owner':null; f.indexAttemptId=f.logAttempt||'legacy-b';
        f.logs=[{...(f.logAttempt?{indexAttemptId:f.logAttempt}:{}),message:'Processed 500000 files, skipped 0',level:'info',timestamp:44}];
        f.emit('index-status',{repoId:f.repo.id});
      }`);
      await page.getByText("Processed 500000 files, skipped 0", { exact: true }).waitFor();
      expect(await page.getByText("Indexing message withheld for privacy.", { exact: true }).count()).toBe(0);
    }
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logDelay=0; f.logAttempt='upload'; f.indexAttemptId='batch-a';
      f.logs=[{indexAttemptId:'upload',message:'Processed 500049 files, skipped 0',level:'info',timestamp:1}];
      f.emit('index-status',{repoId:f.repo.id});
    }`);
    await page.getByText("Processed 500049 files, skipped 0", { exact: true }).waitFor();
    for (const batch of [null, "batch-b"]) {
      const before = await page.evaluate("window.repositoryFixture.logFetches");
      await page.evaluate((id: string | null) => {
        const f = (window as FixtureWindow).repositoryFixture; f.indexAttemptId = id; f.logs = [];
        f.emit("index-status", { repoId: f.repo.id });
      }, batch);
      await page.waitForFunction(`window.repositoryFixture.logFetches > ${before}`);
      await page.getByText("Processed 500049 files, skipped 0", { exact: true }).waitFor();
    }
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='new-upload'; f.indexAttemptId='new-batch';
      f.logs=[{indexAttemptId:'new-upload',message:'Processed 500034 files, skipped 0',level:'info',timestamp:2}];
      f.emit('index-status',{repoId:f.repo.id});
    }`);
    await page.getByText("Processed 500034 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Processed 500049 files, skipped 0", { exact: true }).count()).toBe(0);
    await page.goto(new URL("?tagged-delay=1", server.url).href);
    await page.waitForFunction("window.repositoryFixture.logFetches > 0");
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,message:'Processed 500008 files, skipped 0',level:'info',timestamp:1});
      f.emit('index-log',{repoId:'other-repo',message:'Processed 500020 files, skipped 0',level:'info',timestamp:2});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'old-owner',message:'Processed 500032 files, skipped 0',level:'info',timestamp:3});
    }`);
    await page.getByText("Processed 500008 files, skipped 0", { exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    expect(await page.getByText("Processed 500020 files, skipped 0", { exact: true }).count()).toBe(0);
    expect(await page.getByText("Processed 500032 files, skipped 0", { exact: true }).count()).toBe(0);
    // The stale tagged event can require one follow-up ownership lookup.
    await page.waitForFunction("window.repositoryFixture.logFetches >= 2");
    const initialFetches = await page.evaluate("window.repositoryFixture.logFetches");
    await page.waitForTimeout(1200);
    expect(await page.evaluate("window.repositoryFixture.logFetches")).toBe(initialFetches);
    await page.evaluate(`{
      const f=window.repositoryFixture;
      const tagged={repoId:f.repo.id,indexAttemptId:'first-owner',message:'Processed 500037 files, skipped 0',level:'warning',timestamp:11};
      const untagged={repoId:f.repo.id,message:tagged.message,level:tagged.level,timestamp:tagged.timestamp};
      f.emit('index-log',tagged); f.emit('index-log',untagged);
      f.emit('index-log',{repoId:f.repo.id,message:'Processed 500031 files, skipped 0',level:'warning',timestamp:12});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'first-owner',message:'Processed 500031 files, skipped 0',level:'warning',timestamp:12});
    }`);
    await page.waitForFunction(`document.body.textContent.split('Processed 500037 files, skipped 0').length === 3 && document.body.textContent.split('Processed 500031 files, skipped 0').length === 3`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='replacement-owner'; f.logDelay=0;
      f.emit('index-status',{repoId:f.repo.id});
    }`);
    await page.waitForFunction(`document.body.textContent.split('Processed 500037 files, skipped 0').length === 2 && document.body.textContent.split('Processed 500031 files, skipped 0').length === 2`);
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    const beforeUntaggedOverflow = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=true;
      f.emit('index-status',{repoId:f.repo.id});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeUntaggedOverflow}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=false; f.logDelay=0; f.logAttempt='owner-after-overflow';
      f.logs=[{indexAttemptId:'owner-after-overflow',message:'Processed 500051 files, skipped 0',level:'info',timestamp:1200}];
      for(let i=0;i<1001;i++) f.emit('index-log',{repoId:f.repo.id,message:'Processed '+(i+20000)+' files, skipped 0',level:'warning',timestamp:100+i});
      f.emit('index-status',{repoId:f.repo.id});
    }`);
    await page.getByText("Processed 500051 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText(/^Processed (?:20\d{3}|21000) files, skipped 0$/, { exact: true }).count()).toBe(199);
    for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Show older messages" }).click();
    await page.getByText("Processed 20000 files, skipped 0", { exact: true }).waitFor();
    for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Show newer messages" }).click();
    expect(await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).count()).toBe(0);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='later-owner';
      f.logs=[{indexAttemptId:'later-owner',message:'Processed 500052 files, skipped 0',level:'info',timestamp:1201}];
      f.emit('index-status',{repoId:f.repo.id});
    }`);
    await page.getByText("Processed 500052 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText(/^Processed (?:20\d{3}|21000) files, skipped 0$/, { exact: true }).count()).toBe(199);
    expect(await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).count()).toBe(0);
    await page.goto(new URL("?null-api=1", server.url).href);
    await page.getByText("Initial indexing log", { exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: "Saved indexing messages may be incomplete" }).waitFor();
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    await page.evaluate(`window.repositoryFixture.truncated = true; window.repositoryFixture.emit("index-status", { repoId: "fixture-repo" })`);
    await page.getByRole("alert").filter({ hasText: "Older indexing messages are not shown" }).waitFor();
    await page.goto(new URL("?invalid-api=1", server.url).href);
    await page.getByText("Initial indexing log", { exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    await page.goto(new URL("?old-api=1", server.url).href);
    await page.getByText("Initial indexing log", { exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    await page.evaluate(`window.repositoryFixture.emit('index-log',{repoId:'fixture-repo',message:'Processed 500016 files, skipped 0',level:'info',timestamp:2})`);
    await page.getByText("Processed 500016 files, skipped 0", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logs=[{message:'Processed 500014 files, skipped 0',level:'info',timestamp:3}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.getByText("Processed 500014 files, skipped 0", { exact: true }).waitFor();
    await page.getByText("Processed 500016 files, skipped 0", { exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    await page.goto(server.url.href);
    const toggle = page.getByRole("switch", { name: "Auto Review", exact: true });
    await toggle.waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    expect(await toggle.isEnabled()).toBe(true);
    await toggle.click();
    await page.getByRole("alert").filter({ hasText: "Fixture permission denied" }).waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("true");
    await page.evaluate("window.repositoryFixture.toggleError=''");
    await toggle.click();
    await page.waitForFunction("window.repositoryFixture.repo.autoReview === false");
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
    await page.getByRole("button", { name: "Index now", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Fixture indexing cooldown" }).waitFor();
    expect(await page.getByRole("button", { name: "Index now", exact: true }).isEnabled()).toBe(true);
    expect(await page.getByText("Waiting for logs...", { exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Sync", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Fixture sync failed" }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture;f.repo.indexStatus='failed';
      f.logs=[{message:'Processed 500033 files, skipped 0',level:'error',timestamp:1},
        {message:'Processed 500033 files, skipped 0',level:'error',timestamp:1},
        {message:'Processed 500002 files, skipped 0',level:'info',timestamp:1},
        {message:'Processed 500002 files, skipped 0',level:'warning',timestamp:1}];f.refresh();
    }`);
    await page.getByText("Processed 500033 files, skipped 0", { exact: true }).first().waitFor();
    expect(await page.getByText("Processed 500033 files, skipped 0", { exact: true }).count()).toBe(2);
    expect(await page.getByText("Processed 500002 files, skipped 0", { exact: true }).count()).toBe(2);
    expect(await page.getByRole("link", { name: "Check Bitbucket connection" }).getAttribute("href")).toBe("/settings/integrations#bitbucket");
    await page.evaluate("window.repositoryFixture.indexError=''");
    await page.getByRole("button", { name: "Retry indexing", exact: true }).click();
    await page.getByText("Waiting for logs...", { exact: true }).waitFor();
    expect(await page.getByText("Processed 500033 files, skipped 0", { exact: true }).count()).toBe(0);
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
    await toggle.click();
    await page.waitForFunction("window.repositoryFixture.repo.autoReview === true");
    await toggle.click();
    await page.waitForFunction("window.repositoryFixture.repo.autoReview === false");
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,message:'Processed 500015 files, skipped 0',level:'info',timestamp:2});
      f.emit('index-log',{repoId:f.repo.id,message:'Processed 500030 files, skipped 0',level:'error',timestamp:2});
      f.emit('index-log',{repoId:f.repo.id,message:'Processed 500030 files, skipped 0',level:'error',timestamp:2});
      f.emit('index-log',{repoId:f.repo.id,message:'Processed 500030 files, skipped 0',level:'warning',timestamp:2});
    }`);
    await page.getByText("Processed 500015 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Processed 500030 files, skipped 0", { exact: true }).count()).toBe(3);
    await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
    await page.getByRole("alert").filter({ hasText: "Fixture cancellation failed" }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture;f.logsFail=true;f.repo.indexStatus='failed';
      f.emit('index-status',{repoId:f.repo.id,status:'failed'});f.refresh();
    }`);
    await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).waitFor();
    const beforeFailedLive = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:'other-repo',message:'Processed 500028 files, skipped 0',level:'info',timestamp:3});
      f.emit('index-log',{repoId:f.repo.id,message:'Processed 500003 files, skipped 0',level:'info',timestamp:3});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeFailedLive}`);
    await page.waitForTimeout(300);
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeFailedLive).toBe(1);
    expect(await page.getByText("Processed 500003 files, skipped 0", { exact: true }).count()).toBe(1);
    expect(await page.getByText("Processed 500028 files, skipped 0", { exact: true }).count()).toBe(0);
    await page.evaluate("window.repositoryFixture.logsFail=false");
    await page.getByText("Processed 500003 files, skipped 0", { exact: true }).waitFor();
    await page.waitForFunction("!document.body.textContent.includes('Could not load indexing logs')");
    expect(await page.getByText("Processed 500003 files, skipped 0", { exact: true }).count()).toBe(1);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logsFail=true;
      f.emit('index-status',{repoId:f.repo.id,status:'failed'});
    }`);
    await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture;f.logsFail=false;
      f.logs=[{message:'Processed 500048 files, skipped 0',level:'error',timestamp:3},
        {message:'Processed 500030 files, skipped 0',level:'error',timestamp:2},
        {message:'Processed 500030 files, skipped 0',level:'warning',timestamp:2},
        {message:'Processed 500015 files, skipped 0',level:'info',timestamp:2},
        {message:'Processed 500004 files, skipped 0',level:'info',timestamp:2}];
    }`);
    const callsBeforeLogRetry = await page.evaluate("window.repositoryFixture.indexCalls");
    await page.getByRole("button", { name: "Retry loading logs", exact: true }).click();
    await page.getByText("Processed 500048 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Processed 500030 files, skipped 0", { exact: true }).count()).toBe(5);
    expect(await page.getByText("Processed 500015 files, skipped 0", { exact: true }).count()).toBe(2);
    expect(await page.getByText("Processed 500004 files, skipped 0", { exact: true }).count()).toBe(1);
    expect(await page.evaluate("window.repositoryFixture.indexCalls")).toBe(callsBeforeLogRetry);
    expect(await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).count()).toBe(0);
    // A background retry does not remount RepoDetail or click its index action.
    const beforeBackgroundRetry = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture;f.logs=[];f.indexAttemptId='old-legacy';f.repo.indexStatus='indexing';
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeBackgroundRetry}`);
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    await page.waitForFunction(`!document.body.textContent.includes('Processed 500048 files, skipped 0')`);
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,message:'Processed 500009 files, skipped 0',level:'info',timestamp:4});
    }`);
    await page.getByText("Processed 500009 files, skipped 0", { exact: true }).waitFor();
    const beforeLegacyReload = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logs=[{message:'Processed 500021 files, skipped 0',level:'info',timestamp:5}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeLegacyReload}`);
    await page.getByText("Processed 500021 files, skipped 0", { exact: true }).waitFor();
    await page.getByText("Processed 500009 files, skipped 0", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='old-legacy';
      f.logs=[{indexAttemptId:'old-legacy',message:'Processed 500047 files, skipped 0',level:'info',timestamp:5}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.getByText("Processed 500047 files, skipped 0", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt=null;
      f.logs=[{message:'Processed 500045 files, skipped 0',level:'info',timestamp:5}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.getByText("Processed 500045 files, skipped 0", { exact: true }).waitFor();
    await page.evaluate(`window.repositoryFixture.emit('index-log',{repoId:'fixture-repo',message:'Processed 500046 files, skipped 0',level:'info',timestamp:5})`);
    await page.getByText("Processed 500046 files, skipped 0", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture; f.omitIndexAttemptId=true;
      f.logs=[{message:'Processed 500043 files, skipped 0',level:'info',timestamp:6}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.getByText("Processed 500043 files, skipped 0", { exact: true }).waitFor();
    await page.getByText("Processed 500046 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).count()).toBe(1);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.omitIndexAttemptId=false; f.invalidIndexAttemptId=true;
      f.logs=[{message:'Processed 500010 files, skipped 0',level:'info',timestamp:7}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.getByText("Processed 500010 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).count()).toBe(1);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.invalidIndexAttemptId=false;
      f.logs=[{message:'Processed 500042 files, skipped 0',level:'info',timestamp:8}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.getByText("Processed 500042 files, skipped 0", { exact: true }).waitFor();
    await page.getByText("Processed 500046 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).count()).toBe(1);
    await page.evaluate(`window.repositoryFixture.emit('index-log',{repoId:'fixture-repo',message:'Processed 500006 files, skipped 0',level:'info',timestamp:9})`);
    await page.getByText("Processed 500006 files, skipped 0", { exact: true }).waitFor();
    const beforeLegacyReplacement = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.indexAttemptId='replacement-legacy';
      f.logs=[{message:'Processed 500023 files, skipped 0',level:'info',timestamp:5}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeLegacyReplacement}`);
    await page.getByText("Processed 500023 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Processed 500042 files, skipped 0", { exact: true }).count()).toBe(0);
    await page.getByText("Processed 500046 files, skipped 0", { exact: true }).waitFor();
    await page.getByText("Processed 500006 files, skipped 0", { exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    await page.evaluate(`window.repositoryFixture.emit('index-log',{repoId:'fixture-repo',message:'Processed 500005 files, skipped 0',level:'info',timestamp:6})`);
    await page.getByText("Processed 500005 files, skipped 0", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='replacement-legacy';
      f.logs=[{indexAttemptId:'replacement-legacy',message:'Processed 500050 files, skipped 0',level:'info',timestamp:10}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.getByText("Processed 500050 files, skipped 0", { exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: "Saved indexing messages may be incomplete" }).waitFor();
    await page.getByText("Processed 500005 files, skipped 0", { exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt=null; f.indexAttemptId=null;
      f.logs=[{message:'Processed 500018 files, skipped 0',level:'info',timestamp:11}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.getByText("Processed 500018 files, skipped 0", { exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    await page.evaluate("window.repositoryFixture.repo.indexStatus='failed'; window.repositoryFixture.refresh()");
    await page.getByRole("button", { name: "Retry indexing", exact: true }).waitFor();
    const beforeAttemptFetch = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='current-attempt'; f.logs=[];
      f.repo.indexStatus='indexing'; f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeAttemptFetch}`);
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'old-attempt',message:'Processed 500035 files, skipped 0',level:'error',timestamp:5});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'current-attempt',message:'Processed 500039 files, skipped 0',level:'info',timestamp:6});
    }`);
    await page.getByText("Processed 500039 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Processed 500035 files, skipped 0", { exact: true }).count()).toBe(0);
    await page.waitForTimeout(600);
    const beforeStaleRefresh = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'old-attempt',message:'Processed 500024 files, skipped 0',level:'error',timestamp:7});
    }`);
    await page.waitForTimeout(600);
    expect(await page.evaluate("window.repositoryFixture.logFetches")).toBe(beforeStaleRefresh);
    await page.getByText("Processed 500039 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Processed 500024 files, skipped 0", { exact: true }).count()).toBe(0);
    const beforeDelayedFetch = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='next-attempt'; f.logDelay=200; f.logs=[];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeDelayedFetch}`);
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,message:'Processed 500012 files, skipped 0',level:'warning',timestamp:7});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'current-attempt',message:'Processed 500026 files, skipped 0',level:'error',timestamp:7});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'next-attempt',message:'Processed 500025 files, skipped 0',level:'info',timestamp:8});
    }`);
    await page.getByText("Processed 500025 files, skipped 0", { exact: true }).waitFor();
    await page.getByText("Processed 500012 files, skipped 0", { exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "multiple attempts or be missing" }).waitFor();
    expect(await page.getByText("Processed 500026 files, skipped 0", { exact: true }).count()).toBe(0);
    const beforeSnapshot = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logDelay=400;
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeSnapshot}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='snapshot-replacement'; f.logDelay=0;
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'snapshot-replacement',message:'Processed 500001 files, skipped 0',level:'info',timestamp:9});
    }`);
    await page.getByText("Processed 500001 files, skipped 0", { exact: true }).waitFor();
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeSnapshot).toBeGreaterThanOrEqual(2);
    expect(await page.getByText("Processed 500025 files, skipped 0", { exact: true }).count()).toBe(0);
    await page.getByText("Processed 500012 files, skipped 0", { exact: true }).waitFor();
    const beforeNormalStream = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`(async()=>{
      const f=window.repositoryFixture;
      for(let i=0;i<30;i++){ f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'normal-stale',message:'Processed '+(i+40000)+' files, skipped 0',level:'info',timestamp:100+i}); await new Promise(resolve=>setTimeout(resolve,20)); }
    })()`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeNormalStream}`, null, { timeout: 5000 });
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeNormalStream).toBe(1);
    const beforeHangingFetch = await page.evaluate("window.repositoryFixture.logFetches");
    const beforeHangingAbort = await page.evaluate("window.repositoryFixture.logAborts");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=true; f.logAttempt='hang-replacement'; f.logs=[];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeHangingFetch}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=false;
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'snapshot-replacement',message:'Processed 500027 files, skipped 0',level:'info',timestamp:10});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'hang-replacement',message:'Processed 500019 files, skipped 0',level:'info',timestamp:11});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logAborts > ${beforeHangingAbort}`);
    await page.getByText("Processed 500019 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Processed 500027 files, skipped 0", { exact: true }).count()).toBe(0);
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeHangingFetch).toBe(2);
    const beforeOverflowFetch = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=true; f.logAttempt='overflow-attempt'; f.logs=[];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeOverflowFetch}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=false;
      for(let i=0;i<550;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'overflow-attempt',message:'Processed '+(i+60000)+' files, skipped 0',level:'warning',timestamp:1000+i});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'obsolete-attempt',message:'Processed 500011 files, skipped 0',level:'warning',timestamp:2000});
    }`);
    await page.getByText("Processed 60549 files, skipped 0", { exact: true }).waitFor();
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Show older messages" }).click();
    await page.getByText("Processed 60000 files, skipped 0", { exact: true }).waitFor();
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Show newer messages" }).click();
    expect(await page.getByText("Processed 500011 files, skipped 0", { exact: true }).count()).toBe(0);
    const beforePressureFetch = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=true; f.logAttempt='pressure-attempt'; f.logs=[];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforePressureFetch}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=false;
      for(let i=0;i<1100;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'pressure-attempt',message:'Processed '+(i+80000)+' files, skipped 0',level:'warning',timestamp:3000+i});
    }`);
    await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).waitFor({ timeout: 5000 });
    await page.getByText("Processed 81099 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByText("Processed 80000 files, skipped 0", { exact: true }).count()).toBe(0);
    expect(await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).count()).toBe(1);
    const beforeSameAttempt = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate("window.repositoryFixture.emit('index-status',{repoId:window.repositoryFixture.repo.id})");
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeSameAttempt}`);
    await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).waitFor();
    const beforeCleanAttempt = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='clean-attempt';
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeCleanAttempt}`);
    await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).waitFor({ state: "hidden" });
    const beforeReplacementOverflow = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logDelay=400;
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeReplacementOverflow}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='overflow-replacement'; f.logDelay=0;
      for(let i=0;i<1001;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'overflow-replacement',message:'Processed '+(i+100000)+' files, skipped 0',level:'warning',timestamp:5000+i});
    }`);
    await page.getByText("Processed 101000 files, skipped 0", { exact: true }).waitFor();
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeReplacementOverflow).toBeGreaterThanOrEqual(2);
    expect(await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).count()).toBe(1);
    const beforeEvictedAttempt = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logDelay=400;
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeEvictedAttempt}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='evicted-attempt'; f.logDelay=0;
      f.logs=[{indexAttemptId:'evicted-attempt',message:'Processed 500017 files, skipped 0',level:'info',timestamp:8000}];
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'evicted-attempt',message:'Processed 500040 files, skipped 0',level:'info',timestamp:7000});
      for(let i=0;i<1000;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'overflow-replacement',message:'Processed '+(i+120000)+' files, skipped 0',level:'warning',timestamp:7001+i});
    }`);
    await page.getByText("Processed 500017 files, skipped 0", { exact: true }).waitFor();
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeEvictedAttempt).toBeGreaterThanOrEqual(2);
    expect(await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).count()).toBe(1);
    const beforeManyAttempts = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=true; f.logs=[];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeManyAttempts}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=false; f.logAttempt='untracked-attempt';
      for(let i=0;i<1100;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:i===1050?'untracked-attempt':'old-'+i,message:'Processed '+(i+140000)+' files, skipped 0',level:'warning',timestamp:9000+i});
      for(let i=0;i<1000;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'untracked-attempt',message:'Processed '+(i+160000)+' files, skipped 0',level:'warning',timestamp:11000+i});
    }`);
    await page.getByText("Processed 160999 files, skipped 0", { exact: true }).waitFor();
    expect(await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).count()).toBe(1);
    const beforeUnknownAttempt = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='later-clean-attempt';
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeUnknownAttempt}`);
    await page.waitForTimeout(500);
    expect(await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).count()).toBe(1);
    const beforeUnknownRace = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='owner-a'; f.logHang=true; f.logs=[];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeUnknownRace}`);
    await page.evaluate(`{
      const f=window.repositoryFixture;
      for(let i=0;i<1000;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'stale-race-'+i,message:'Processed '+(i+180000)+' files, skipped 0',level:'warning',timestamp:13000+i});
      for(let i=0;i<1000;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'owner-a',message:'Processed '+(i+200000)+' files, skipped 0',level:'warning',timestamp:14000+i});
      f.logHang=false; f.logDelay=400;
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeUnknownRace + 1}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='owner-b'; f.logDelay=0;
      f.logs=[{indexAttemptId:'owner-b',message:'Processed 500036 files, skipped 0',level:'info',timestamp:16000}];
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'owner-b',message:'Processed 500044 files, skipped 0',level:'info',timestamp:15000});
      for(let i=0;i<1000;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'owner-a',message:'Processed '+(i+220000)+' files, skipped 0',level:'warning',timestamp:15001+i});
    }`);
    await page.getByText("Processed 220999 files, skipped 0", { exact: true }).waitFor();
    await page.evaluate("window.repositoryFixture.logsFail=true");
    await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).waitFor({ timeout: 10000 });
    const beforeOverflowRetry = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate("window.repositoryFixture.logsFail=false");
    await page.waitForTimeout(1200);
    expect(await page.evaluate("window.repositoryFixture.logFetches")).toBe(beforeOverflowRetry);
    await page.getByText("Processed 500036 files, skipped 0", { exact: true }).waitFor({ timeout: 10000 });
    expect(await page.evaluate("window.repositoryFixture.logFetches")).toBe(beforeOverflowRetry + 1);
    expect(await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).count()).toBe(1);
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeUnknownRace).toBeLessThanOrEqual(5);
    const beforeOverflowStream = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`(async()=>{
      const f=window.repositoryFixture;
      for(let i=0;i<20;i++) { f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'stale-stream-'+i,message:'Processed '+(i+240000)+' files, skipped 0',level:'warning',timestamp:17000+i}); await new Promise(resolve=>setTimeout(resolve,30)); }
    })()`);
    await page.waitForTimeout(1200);
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeOverflowStream).toBeLessThanOrEqual(1);
    const beforeCancelledFetch = await page.evaluate("window.repositoryFixture.logFetches");
    const beforeCancelledAbort = await page.evaluate("window.repositoryFixture.logAborts");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=true;
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeCancelledFetch}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=false;
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logAborts > ${beforeCancelledAbort} && window.repositoryFixture.logFetches >= ${beforeCancelledFetch + 2}`);
    await page.waitForTimeout(1200);
    expect(await page.evaluate("window.repositoryFixture.logFetches")).toBe(beforeCancelledFetch + 2);
    expect(await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).count()).toBe(0);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logDelay=0; f.logAttempt=null;
      f.logs=[{message:'Processed 500041 files, skipped 0',level:'info',timestamp:18000}];
      f.emit('index-status',{repoId:f.repo.id});
    }`);
    await page.getByText("Processed 500041 files, skipped 0", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,message:'Processed 500022 files, skipped 0',level:'info',timestamp:18001});
    }`);
    await page.getByText("Processed 500022 files, skipped 0", { exact: true }).waitFor();
    const beforeMixedEvents = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`(async()=>{
      const f=window.repositoryFixture;
      for(let i=0;i<30;i++){ f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'mixed-attempt',message:'Processed '+(i+260000)+' files, skipped 0',level:'info',timestamp:100+i}); await new Promise(resolve=>setTimeout(resolve,20)); }
    })()`);
    const mixedFetches = (await page.evaluate("window.repositoryFixture.logFetches")) - beforeMixedEvents;
    console.log(`Mixed-version log refreshes: ${mixedFetches}`);
    expect(mixedFetches).toBeLessThanOrEqual(1);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeMixedEvents}`, null, { timeout: 10000 });
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeMixedEvents).toBe(1);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='replacement-attempt';
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'replacement-attempt',message:'Processed 500029 files, skipped 0',level:'info',timestamp:200});
    }`);
    await page.getByText("Processed 500029 files, skipped 0", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture;f.repo.indexStatus='indexed';
      f.emit('index-status',{repoId:f.repo.id,status:'indexed'});
    }`);
    await page.getByRole("button", { name: "Re-index", exact: true }).waitFor();
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
    await page.goto(new URL("?view=dashboard", server.url).href);
    const desktop = page.locator("table");
    await desktop.getByRole("button", { name: "Index now", exact: true }).waitFor();
    await page.evaluate("window.repositoryFixture.indexDelay=150");
    await desktop.getByRole("button", { name: "Index now", exact: true }).click();
    await desktop.getByRole("button", { name: "Starting…", exact: true }).waitFor();
    expect(await desktop.getByText("Indexing…", { exact: true }).count()).toBe(0);
    await desktop.getByRole("alert").filter({ hasText: "Fixture indexing cooldown" }).waitFor();
    expect(await desktop.getByRole("button", { name: "Index now", exact: true }).isEnabled()).toBe(true);
    // A very fast completion event must survive the original action returning.
    await page.evaluate("Object.assign(window.repositoryFixture,{indexError:'',indexDelay:0,fastComplete:true})");
    await desktop.getByRole("button", { name: "Index now", exact: true }).click();
    await desktop.getByRole("button", { name: "Re-index", exact: true }).waitFor();
    expect(await desktop.getByText("Indexing…", { exact: true }).count()).toBe(0);
    await page.evaluate("window.repositoryFixture.indexError='Fixture re-index cooldown'");
    await desktop.getByRole("button", { name: "Re-index", exact: true }).click();
    await desktop.getByRole("alert").filter({ hasText: "Fixture re-index cooldown" }).waitFor();
    expect(await desktop.getByText("Indexed", { exact: true }).count()).toBe(1);
    await page.evaluate(`{
      const f=window.repositoryFixture;f.repo.indexStatus='failed';f.logs=[];f.refresh();
    }`);
    await desktop.getByRole("button", { name: "Retry indexing", exact: true }).waitFor();
    await desktop.getByRole("button", { name: "Retry indexing", exact: true }).click();
    await desktop.getByRole("alert").filter({ hasText: "Fixture re-index cooldown" }).waitFor();
    expect(await desktop.getByRole("link", { name: "Check Bitbucket connection" }).first().getAttribute("href")).toBe("/settings/integrations#bitbucket");
    await page.evaluate("Object.assign(window.repositoryFixture,{indexError:'',fastComplete:false})");
    await desktop.getByRole("button", { name: "Retry indexing", exact: true }).click();
    await desktop.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    await desktop.getByRole("button", { name: "Cancel", exact: true }).click();
    await desktop.getByRole("alert").filter({ hasText: "Fixture cancellation failed" }).waitFor();
    await page.evaluate("window.repositoryFixture.cancelError=''");
    await desktop.getByRole("button", { name: "Cancel", exact: true }).click();
    await desktop.getByRole("button", { name: "Index now", exact: true }).waitFor();
    expect(await desktop.getByText("Indexing…", { exact: true }).count()).toBe(0);
    await page.evaluate("window.repositoryFixture.allowed=false;window.repositoryFixture.refresh()");
    expect(await desktop.getByRole("button", { name: "Index now", exact: true }).isDisabled()).toBe(true);
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
  } finally { await browser.close(); server.stop(true); }
}, 120_000);
