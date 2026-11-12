import { createRoot } from "react-dom/client";
import { IndexingLogs } from "@/components/indexing-logs";

const listeners = new Map<string, (data: unknown) => void>();
const fixture = {
  attempt: null as string | null,
  fail: false,
  delay: 0,
  logs: [] as Array<{ indexAttemptId: string; message: string; level: string; timestamp: number }>,
  fetches: 0,
  channel: { bind: (name: string, fn: (data: unknown) => void) => listeners.set(name, fn), unbind: (name: string) => listeners.delete(name) },
  emit: (event: string, data: unknown) => listeners.get(event)?.(data),
  setScope: (repoId: string) => root.render(<IndexingLogs repoId={repoId} orgId="org" initialStatus="indexing" provider="github" />),
};
Object.assign(window, { privacyFixture: fixture });
window.fetch = async () => {
  fixture.fetches++;
  const { delay, fail, logs, attempt } = fixture;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  return fail ? new Response(null, { status: 503 }) : Response.json({ logs, attempt, indexAttemptId: attempt ?? "legacy" });
};
const root = createRoot(document.getElementById("root")!);
fixture.setScope("repo");
