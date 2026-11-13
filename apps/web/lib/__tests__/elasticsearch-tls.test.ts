import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { join, resolve } from "node:path";

const appDir = resolve(import.meta.dir, "../..");
let dir = "", bundle = "", cert = "", key = "";
beforeAll(async () => {
  dir = await mkdtemp(join(appDir, ".es-tls-test-"));
  bundle = join(dir, "client.cjs"); cert = join(dir, "cert.pem"); key = join(dir, "key.pem");
  const config = join(dir, "openssl.cnf");
  await writeFile(config, "[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=synthetic.invalid\n[v3]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n");
  const certResult = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-config", config], { stdout: "ignore", stderr: "pipe" });
  expect(certResult.exitCode, certResult.stderr.toString()).toBe(0);
  const compiled = Bun.spawnSync([process.execPath, "build", "lib/elasticsearch.ts", "--target=node", "--format=cjs", "--external", "@elastic/elasticsearch", "--outfile", bundle], { cwd: appDir, stdout: "pipe", stderr: "pipe" });
  expect(compiled.exitCode, compiled.stderr.toString()).toBe(0);
}, 30_000);
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

async function checkConnection(mode: "untrusted" | "trusted" | "wrong-host" | "http") {
  let requests = 0, syntheticAuth = false;
  const handle = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    requests++;
    syntheticAuth = req.headers.authorization === `Basic ${Buffer.from("fixture-user:fixture-password").toString("base64")}`;
    req.resume();
    res.writeHead(200, { "content-type": "application/json", "x-elastic-product": "Elasticsearch" });
    res.end(JSON.stringify({ _index: "synthetic", _id: "synthetic", _version: 1, result: "created", _shards: { total: 1, successful: 1, failed: 0 }, _seq_no: 0, _primary_term: 1 }));
  };
  const server = mode === "http" ? createHttpServer(handle) : createHttpsServer({ cert: await readFile(cert), key: await readFile(key) }, handle);
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Synthetic server not bound");
    const host = mode === "wrong-host" ? "localhost" : "127.0.0.1";
    const env = { ...process.env, ELASTICSEARCH_URL: `${mode === "http" ? "http" : "https"}://${host}:${addr.port}`,
      ELASTICSEARCH_USERNAME: "fixture-user", ELASTICSEARCH_PASSWORD: "fixture-password", ELASTICSEARCH_INDEX_PREFIX: "synthetic" };
    delete env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete env.NODE_EXTRA_CA_CERTS;
    if (mode === "trusted" || mode === "wrong-host") env.NODE_EXTRA_CA_CERTS = cert;
    const js = `require('node:dns').setDefaultResultOrder('ipv4first'); const m=require(process.argv[1]); m.writeSyncLog({orgId:'synthetic',repoId:'synthetic',message:'Indexing failed',level:'error',timestamp:Date.now()}).then(()=>process.exit(0),()=>process.exit(1));`;
    const child = Bun.spawn(["node", "-e", js, resolve(bundle)], { env, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try {
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(code, stderr).toBe(0);
    } finally { clearTimeout(timer); }
    return { requests, syntheticAuth };
  } finally { await new Promise<void>(resolveClose => server.close(() => resolveClose())); }
}

describe("Elasticsearch TLS authentication", () => {
  it("does not send credentials to an untrusted certificate", async () => {
    const result = await checkConnection("untrusted");
    expect(result.requests).toBe(0);
  }, 25_000);
  it("accepts a trusted certificate and sends the synthetic log", async () => {
    const result = await checkConnection("trusted");
    expect(result.requests).toBe(1);
    expect(result.syntheticAuth).toBe(true);
  }, 25_000);
  it("rejects a trusted certificate for another hostname", async () => {
    const result = await checkConnection("wrong-host");
    expect(result.requests).toBe(0);
  }, 25_000);
  it("retains explicitly configured HTTP behavior", async () => {
    const result = await checkConnection("http");
    expect(result.requests).toBe(1);
    expect(result.syntheticAuth).toBe(true);
  }, 25_000);
});
