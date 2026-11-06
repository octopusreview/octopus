import { expect, it } from 'bun:test';
it.skipIf(!process.env.PLAYWRIGHT_MODULE_PATH)('withholds synthetic private live text while preserving events and progress', async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH!);
  const modules: Record<string,string> = {
    'next/navigation': 'export function useRouter(){return {refresh(){}}}',
    '@/lib/pubby-client': 'export function getPubbyClient(){return {subscribe(){return window.privacyFixture.channel}}}',
    '@/lib/repository-connection-recovery': 'export function getRepositoryConnectionRecovery(){return {href:"/",label:"Reconnect"}}',
  };
  const build = await Bun.build({ entrypoints:[new URL('./fixtures/indexing-privacy-browser.tsx',import.meta.url).pathname],target:'browser',plugins:[{name:'privacy-prototype',setup(builder){
    builder.onResolve({filter:/^(next\/navigation|@\/lib\/pubby-client|@\/lib\/repository-connection-recovery)$/},({path})=>({path,namespace:'fixture'}));
    builder.onResolve({filter:/^@\//},({path})=>({path:Bun.resolveSync(`./${path.slice(2)}`,new URL('../../',import.meta.url).pathname)}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:modules[path]}));
  }}] });
  expect(build.success,build.logs.join('\n')).toBe(true);
  const bundle=await build.outputs[0].text();
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){return new URL(req.url).pathname==='/fixture.js'?new Response(bundle,{headers:{'Content-Type':'text/javascript'}}):new Response('<div id="root"></div><script type="module" src="/fixture.js"></script>',{headers:{'Content-Type':'text/html'}})}});
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL});
  try {
    const page=await browser.newPage();
    await page.goto(server.url.href);
    await page.getByText('Waiting for logs...').waitFor();
    await page.evaluate(`{
      const f=window.privacyFixture;
      f.emit({repoId:'repo',message:'synthetic-private-path synthetic-secret',level:'error',timestamp:1});
      f.emit({repoId:'repo',message:'synthetic-private-path synthetic-secret',level:'error',timestamp:1});
      f.emit({repoId:'repo',message:'Processing local batch 1/2',level:'info',timestamp:2});
    }`);
    await page.getByText('Processing local batch 1/2').waitFor();
    expect(await page.getByText('Indexing message withheld for privacy.',{exact:true}).count()).toBe(1);
    await page.evaluate(`window.privacyFixture.finish([{message:'Saved indexing message withheld for privacy.',level:'error',timestamp:1},{message:'Repository summary generated',level:'success',timestamp:3}])`);
    await page.getByText('Completed',{exact:true}).waitFor();
    await page.getByText('Repository summary generated',{exact:true}).waitFor();
    expect(await page.getByText('Indexing message withheld for privacy.',{exact:true}).count()).toBe(1);
    expect(await page.locator('body').innerText()).not.toContain('synthetic-private-path');
    expect(await page.locator('body').innerText()).not.toContain('synthetic-secret');
  } finally { await browser.close(); server.stop(true); }
},120000);
