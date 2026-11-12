import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

for (const scenario of ["keyed", "keyless", "wrong", "wrong-signal"]) {
  it(`uses Qdrant authentication for normal and cancellable clients: ${scenario}`, async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/qdrant-auth.ts", import.meta.url)), scenario], {
      stdout: "pipe", stderr: "pipe", env: process.env,
    });
    const watchdog = setTimeout(() => child.kill(), 10_000);
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    clearTimeout(watchdog);
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
  });
}

for (const script of ["backfill-sparse-vectors.ts", "migrate-collections-sparse.ts"]) {
  for (const keyed of [true, false]) {
    it(`${script} uses the configured Qdrant key when present`, async () => {
      const key = "synthetic-maintenance-key";
      const received: Array<string | null> = [];
      const server = Bun.serve({
        hostname: "127.0.0.1", port: 0,
        fetch(request) {
          const supplied = request.headers.get("api-key");
          received.push(supplied);
          if (keyed && supplied !== key) return Response.json({ status: { error: "unauthorized" }, time: 0 }, { status: 401 });
          const path = new URL(request.url).pathname;
          if (path === "/") return Response.json({ title: "qdrant", version: "1.18.0" });
          const result = path === "/collections"
            ? { collections: ["code_chunks", "knowledge_chunks", "review_chunks", "chat_chunks", "flowchart_chunks", "feedback_patterns"].map((name) => ({ name })) }
            : path.endsWith("/scroll") || path.endsWith("/query") ? { points: [], next_page_offset: null } : true;
          return Response.json({ result, status: "ok", time: 0 });
        },
      });
      const path = fileURLToPath(new URL(`../../scripts/${script}`, import.meta.url));
      const child = Bun.spawn([process.execPath, path], {
        stdout: "pipe", stderr: "pipe",
        env: { ...process.env, QDRANT_URL: `http://127.0.0.1:${server.port}`, QDRANT_API_KEY: keyed ? key : "" },
      });
      const watchdog = setTimeout(() => child.kill(), 10_000);
      try {
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit).toBe(0);
        expect(received.length).toBeGreaterThan(1);
        expect(received.every((value) => value === (keyed ? key : null))).toBe(true);
        expect(stdout.includes(key) || stderr.includes(key)).toBe(false);
      } finally {
        clearTimeout(watchdog);
        server.stop(true);
      }
    });
  }
}
