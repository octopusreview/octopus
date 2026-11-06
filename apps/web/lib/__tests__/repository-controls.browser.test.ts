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
      f.emit('index-log',{repoId:f.repo.id,message:'GitHub authentication successful',level:'info',timestamp:2});
      f.emit('index-log',{repoId:f.repo.id,message:'Indexing failed',level:'error',timestamp:2});
      f.emit('index-log',{repoId:f.repo.id,message:'Indexing failed',level:'error',timestamp:2});
      f.emit('index-log',{repoId:f.repo.id,message:'Indexing failed',level:'warning',timestamp:2});
    }`);
    await page.getByText("GitHub authentication successful", { exact: true }).waitFor();
    expect(await page.getByText("Indexing failed", { exact: true }).count()).toBe(2);
    await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
    await page.getByRole("alert").filter({ hasText: "Fixture cancellation failed" }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture;f.logsFail=true;f.repo.indexStatus='failed';
      f.emit('index-status',{repoId:f.repo.id,status:'failed'});f.refresh();
    }`);
    await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).waitFor();
    await page.evaluate(`{
      const f=window.repositoryFixture;f.logsFail=false;
      f.logs=[{message:'Recovered logs',level:'error',timestamp:3},
        {message:'Indexing failed',level:'error',timestamp:2},
        {message:'Indexing failed',level:'warning',timestamp:2},
        {message:'GitHub authentication successful',level:'info',timestamp:2},
        {message:'Reconnect to restore access',level:'info',timestamp:2}];
    }`);
    const callsBeforeLogRetry = await page.evaluate("window.repositoryFixture.indexCalls");
    await page.getByRole("button", { name: "Retry loading logs", exact: true }).click();
    await page.getByText("Recovered logs", { exact: true }).waitFor();
    expect(await page.getByText("Indexing failed", { exact: true }).count()).toBe(2);
    expect(await page.getByText("GitHub authentication successful", { exact: true }).count()).toBe(1);
    expect(await page.getByText("Reconnect to restore access", { exact: true }).count()).toBe(1);
    expect(await page.evaluate("window.repositoryFixture.indexCalls")).toBe(callsBeforeLogRetry);
    expect(await page.getByRole("alert").filter({ hasText: "Could not load indexing logs" }).count()).toBe(0);
    // A background retry does not remount RepoDetail or click its index action.
    await page.evaluate(`{
      const f=window.repositoryFixture;f.logs=[];f.repo.indexStatus='indexing';
      f.emit('index-status',{repoId:f.repo.id,status:'indexing'});
    }`);
    await page.getByText("Waiting for logs...", { exact: true }).waitFor();
    expect(await page.getByText("Recovered logs", { exact: true }).count()).toBe(0);
    await page.evaluate(`{
      const f=window.repositoryFixture;
      f.emit('index-log',{repoId:f.repo.id,message:'Local indexing started',level:'info',timestamp:4});
    }`);
    await page.getByText("Local indexing started", { exact: true }).waitFor();
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
}, 60_000);
