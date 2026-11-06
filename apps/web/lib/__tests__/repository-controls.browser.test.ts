import { expect, it } from "bun:test";

// Real React controls in an isolated browser, with only local action/realtime
// fixtures. No provider requests, production authentication or paid reviews.
it.skipIf(!process.env.PLAYWRIGHT_MODULE_PATH)("recovers repository controls after rejected actions and failed indexing", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH!);
  const build = await Bun.build({
    entrypoints: [new URL("./fixtures/repository-controls-ui.tsx", import.meta.url).pathname], target: "browser",
    plugins: [{ name: "isolated-repository-controls", setup(builder) {
      const modules: Record<string, string> = {
        "next/navigation": `export function useRouter(){return {refresh:()=>window.repositoryFixture.refresh(),push:()=>{}};} export function useSearchParams(){return new URLSearchParams();}`,
        "@/components/link": `export default function Link(props){return window.repositoryFixture.React.createElement('a',props);}`,
        "@/components/chat-provider": `export function useChat(){return {openWithRepoContext(){}};}`,
        "@/components/mermaid-diagram": `export function MermaidDiagram(){return null;}`,
        "@/lib/pubby-client": `export function getPubbyClient(){return {subscribe:()=>window.repositoryFixture.channel};}`,
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
      builder.onResolve({ filter: /^@\// }, ({ path }) => modules[path] ? { path, namespace: "repository-fixture" } : { path: Bun.resolveSync(`./${path.slice(2)}`, new URL("../../", import.meta.url).pathname) });
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
      f.logs=[{message:'Old failed attempt',level:'error',timestamp:1},
        {message:'Old failed attempt',level:'error',timestamp:1},
        {message:'Check repository permissions',level:'info',timestamp:1},
        {message:'Check repository permissions',level:'warning',timestamp:1}];f.refresh();
    }`);
    await page.getByText("Old failed attempt", { exact: true }).waitFor();
    expect(await page.getByText("Old failed attempt", { exact: true }).count()).toBe(1);
    expect(await page.getByText("Check repository permissions", { exact: true }).count()).toBe(2);
    expect(await page.getByRole("link", { name: "Check Bitbucket connection" }).getAttribute("href")).toBe("/settings/integrations#bitbucket");
    await page.evaluate("window.repositoryFixture.indexError=''");
    await page.getByRole("button", { name: "Retry indexing", exact: true }).click();
    await page.getByText("Waiting for logs...", { exact: true }).waitFor();
    expect(await page.getByText("Old failed attempt", { exact: true }).count()).toBe(0);
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
    await toggle.click();
    await page.waitForFunction("window.repositoryFixture.repo.autoReview === true");
    await toggle.click();
    await page.waitForFunction("window.repositoryFixture.repo.autoReview === false");
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,message:'Retry progress received',level:'info',timestamp:2});
      f.emit('index-log',{repoId:f.repo.id,message:'Retry access denied',level:'error',timestamp:2});
      f.emit('index-log',{repoId:f.repo.id,message:'Retry access denied',level:'error',timestamp:2});
      f.emit('index-log',{repoId:f.repo.id,message:'Retry access denied',level:'warning',timestamp:2});
    }`);
    await page.getByText("Retry progress received", { exact: true }).waitFor();
    expect(await page.getByText("Retry access denied", { exact: true }).count()).toBe(2);
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
      f.emit('index-log',{repoId:'other-repo',message:'Other repository log',level:'info',timestamp:3});
      f.emit('index-log',{repoId:f.repo.id,message:'Live log after failed fetch',level:'info',timestamp:3});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeFailedLive}`);
    await page.waitForTimeout(300);
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeFailedLive).toBe(1);
    expect(await page.getByText("Live log after failed fetch", { exact: true }).count()).toBe(0);
    expect(await page.getByText("Other repository log", { exact: true }).count()).toBe(0);
    await page.evaluate("window.repositoryFixture.logsFail=false");
    await page.getByText("Live log after failed fetch", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logsFail=true;
      f.emit('index-status',{repoId:f.repo.id,status:'failed'});
    }`);
    await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture;f.logsFail=false;
      f.logs=[{message:'Recovered logs',level:'error',timestamp:3},
        {message:'Retry access denied',level:'error',timestamp:2},
        {message:'Retry access denied',level:'warning',timestamp:2},
        {message:'Retry progress received',level:'info',timestamp:2},
        {message:'Reconnect to restore access',level:'info',timestamp:2}];
    }`);
    const callsBeforeLogRetry = await page.evaluate("window.repositoryFixture.indexCalls");
    await page.getByRole("button", { name: "Retry loading logs", exact: true }).click();
    await page.getByText("Recovered logs", { exact: true }).waitFor();
    expect(await page.getByText("Retry access denied", { exact: true }).count()).toBe(2);
    expect(await page.getByText("Retry progress received", { exact: true }).count()).toBe(1);
    expect(await page.getByText("Reconnect to restore access", { exact: true }).count()).toBe(1);
    expect(await page.evaluate("window.repositoryFixture.indexCalls")).toBe(callsBeforeLogRetry);
    expect(await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).count()).toBe(0);
    // A background retry does not remount RepoDetail or click its index action.
    await page.evaluate(`{
      const f=window.repositoryFixture;f.logs=[];f.indexAttemptId='old-legacy';f.repo.indexStatus='indexing';
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.getByText("Waiting for logs...", { exact: true }).waitFor();
    expect(await page.getByText("Recovered logs", { exact: true }).count()).toBe(0);
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,message:'Background retry progress',level:'info',timestamp:4});
    }`);
    await page.getByText("Background retry progress", { exact: true }).waitFor();
    const beforeLegacyReload = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logs=[{message:'Same attempt saved log',level:'info',timestamp:5}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeLegacyReload}`);
    await page.getByText("Same attempt saved log", { exact: true }).waitFor();
    await page.getByText("Background retry progress", { exact: true }).waitFor();
    const beforeLegacyReplacement = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.indexAttemptId='replacement-legacy';
      f.logs=[{message:'Replacement saved log',level:'info',timestamp:5}];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeLegacyReplacement}`);
    await page.getByText("Replacement saved log", { exact: true }).waitFor();
    expect(await page.getByText("Background retry progress", { exact: true }).count()).toBe(0);
    await page.evaluate(`window.repositoryFixture.emit('index-log',{repoId:'fixture-repo',message:'Replacement legacy live log',level:'info',timestamp:6})`);
    await page.getByText("Replacement legacy live log", { exact: true }).waitFor();
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
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'old-attempt',message:'Obsolete live log',level:'error',timestamp:5});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'current-attempt',message:'Current live log',level:'info',timestamp:6});
    }`);
    await page.getByText("Current live log", { exact: true }).waitFor();
    expect(await page.getByText("Obsolete live log", { exact: true }).count()).toBe(0);
    await page.waitForTimeout(600);
    const beforeStaleRefresh = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'old-attempt',message:'Another obsolete log',level:'error',timestamp:7});
    }`);
    await page.waitForTimeout(600);
    expect(await page.evaluate("window.repositoryFixture.logFetches")).toBe(beforeStaleRefresh);
    await page.getByText("Current live log", { exact: true }).waitFor();
    expect(await page.getByText("Another obsolete log", { exact: true }).count()).toBe(0);
    const beforeDelayedFetch = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='next-attempt'; f.logDelay=200; f.logs=[];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeDelayedFetch}`);
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'current-attempt',message:'Delayed obsolete log',level:'error',timestamp:7});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'next-attempt',message:'Buffered current log',level:'info',timestamp:8});
    }`);
    await page.getByText("Buffered current log", { exact: true }).waitFor();
    expect(await page.getByText("Delayed obsolete log", { exact: true }).count()).toBe(0);
    const beforeSnapshot = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logDelay=400;
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeSnapshot}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='snapshot-replacement'; f.logDelay=0;
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'snapshot-replacement',message:'Live log after stale snapshot',level:'info',timestamp:9});
    }`);
    await page.getByText("Live log after stale snapshot", { exact: true }).waitFor();
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeSnapshot).toBeGreaterThanOrEqual(2);
    expect(await page.getByText("Buffered current log", { exact: true }).count()).toBe(0);
    const beforeNormalStream = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`(async()=>{
      const f=window.repositoryFixture;
      for(let i=0;i<30;i++){ f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'normal-stale',message:'Normal stale '+i,level:'info',timestamp:100+i}); await new Promise(resolve=>setTimeout(resolve,20)); }
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
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'snapshot-replacement',message:'Obsolete during hang',level:'info',timestamp:10});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'hang-replacement',message:'Live log after timeout',level:'info',timestamp:11});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logAborts > ${beforeHangingAbort}`);
    await page.getByText("Live log after timeout", { exact: true }).waitFor();
    expect(await page.getByText("Obsolete during hang", { exact: true }).count()).toBe(0);
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeHangingFetch).toBe(2);
    const beforeOverflowFetch = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=true; f.logAttempt='overflow-attempt'; f.logs=[];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeOverflowFetch}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=false;
      for(let i=0;i<550;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'overflow-attempt',message:'Buffered warning '+i,level:'warning',timestamp:1000+i});
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'obsolete-attempt',message:'Obsolete overflow warning',level:'warning',timestamp:2000});
    }`);
    await page.getByText("Buffered warning 0", { exact: true }).waitFor();
    expect(await page.getByText("Buffered warning 549", { exact: true }).count()).toBe(1);
    expect(await page.getByText("Obsolete overflow warning", { exact: true }).count()).toBe(0);
    const beforePressureFetch = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=true; f.logAttempt='pressure-attempt'; f.logs=[];
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforePressureFetch}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logHang=false;
      for(let i=0;i<1100;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'pressure-attempt',message:'Pressure warning '+i,level:'warning',timestamp:3000+i});
    }`);
    await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).waitFor({ timeout: 5000 });
    await page.getByText("Pressure warning 1099", { exact: true }).waitFor();
    expect(await page.getByText("Pressure warning 0", { exact: true }).count()).toBe(0);
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
      for(let i=0;i<1001;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'overflow-replacement',message:'Replacement warning '+i,level:'warning',timestamp:5000+i});
    }`);
    await page.getByText("Replacement warning 1000", { exact: true }).waitFor();
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
      f.logs=[{indexAttemptId:'evicted-attempt',message:'Evicted attempt loaded',level:'info',timestamp:8000}];
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'evicted-attempt',message:'Evicted live log',level:'info',timestamp:7000});
      for(let i=0;i<1000;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'overflow-replacement',message:'Old warning '+i,level:'warning',timestamp:7001+i});
    }`);
    await page.getByText("Evicted attempt loaded", { exact: true }).waitFor();
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
      for(let i=0;i<1100;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:i===1050?'untracked-attempt':'old-'+i,message:'Old attempt '+i,level:'warning',timestamp:9000+i});
      for(let i=0;i<1000;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'untracked-attempt',message:'Current attempt '+i,level:'warning',timestamp:11000+i});
    }`);
    await page.getByText("Current attempt 999", { exact: true }).waitFor();
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
      for(let i=0;i<1000;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'stale-race-'+i,message:'Old race '+i,level:'warning',timestamp:13000+i});
      for(let i=0;i<1000;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'owner-a',message:'Owner A '+i,level:'warning',timestamp:14000+i});
      f.logHang=false; f.logDelay=400;
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeUnknownRace + 1}`);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='owner-b'; f.logDelay=0;
      f.logs=[{indexAttemptId:'owner-b',message:'Recovered owner B',level:'info',timestamp:16000}];
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'owner-b',message:'Evicted B event',level:'info',timestamp:15000});
      for(let i=0;i<1000;i++) f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'owner-a',message:'More A '+i,level:'warning',timestamp:15001+i});
    }`);
    await page.getByText("More A 999", { exact: true }).waitFor();
    await page.evaluate("window.repositoryFixture.logsFail=true");
    await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).waitFor({ timeout: 10000 });
    const beforeOverflowRetry = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate("window.repositoryFixture.logsFail=false");
    await page.waitForTimeout(1200);
    expect(await page.evaluate("window.repositoryFixture.logFetches")).toBe(beforeOverflowRetry);
    await page.getByText("Recovered owner B", { exact: true }).waitFor({ timeout: 10000 });
    expect(await page.evaluate("window.repositoryFixture.logFetches")).toBe(beforeOverflowRetry + 1);
    expect(await page.getByRole("alert").filter({ hasText: "Some indexing messages may be missing" }).count()).toBe(1);
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeUnknownRace).toBeLessThanOrEqual(5);
    const beforeOverflowStream = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`(async()=>{
      const f=window.repositoryFixture;
      for(let i=0;i<20;i++) { f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'stale-stream-'+i,message:'Stale stream '+i,level:'warning',timestamp:17000+i}); await new Promise(resolve=>setTimeout(resolve,30)); }
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
      f.logs=[{message:'Legacy saved log',level:'info',timestamp:18000}];
      f.emit('index-status',{repoId:f.repo.id});
    }`);
    await page.getByText("Legacy saved log", { exact: true }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,message:'Legacy live log',level:'info',timestamp:18001});
    }`);
    await page.getByText("Legacy live log", { exact: true }).waitFor();
    const beforeMixedEvents = await page.evaluate("window.repositoryFixture.logFetches");
    await page.evaluate(`(async()=>{
      const f=window.repositoryFixture;
      for(let i=0;i<30;i++){ f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'mixed-attempt',message:'mixed '+i,level:'info',timestamp:100+i}); await new Promise(resolve=>setTimeout(resolve,20)); }
    })()`);
    const mixedFetches = (await page.evaluate("window.repositoryFixture.logFetches")) - beforeMixedEvents;
    console.log(`Mixed-version log refreshes: ${mixedFetches}`);
    expect(mixedFetches).toBeLessThanOrEqual(1);
    await page.waitForFunction(`window.repositoryFixture.logFetches > ${beforeMixedEvents}`, null, { timeout: 10000 });
    expect((await page.evaluate("window.repositoryFixture.logFetches")) - beforeMixedEvents).toBe(1);
    await page.evaluate(`{
      const f=window.repositoryFixture; f.logAttempt='replacement-attempt';
      f.emit('index-log',{repoId:f.repo.id,indexAttemptId:'replacement-attempt',message:'Replacement live log',level:'info',timestamp:200});
    }`);
    await page.getByText("Replacement live log", { exact: true }).waitFor();
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
