import { createRoot } from "react-dom/client";
import { IndexingLogs } from "@/components/indexing-logs";

const listeners = new Map<string, (data: unknown) => void>();
const fixture = {
  attempt: null as string | null,
  fail: false,
  fetches: 0,
  channel: { bind: (name: string, fn: (data: unknown) => void) => listeners.set(name, fn), unbind: (name: string) => listeners.delete(name) },
  emit: (event: string, data: unknown) => listeners.get(event)?.(data),
};
Object.assign(window, { privacyFixture: fixture });
window.fetch = async () => {
  fixture.fetches++;
  return fixture.fail ? new Response(null, { status: 503 }) : Response.json({ logs: [], attempt: fixture.attempt, indexAttemptId: fixture.attempt ?? "legacy" });
};
createRoot(document.getElementById("root")!).render(<IndexingLogs repoId="repo" orgId="org" initialStatus="indexing" provider="github" />);
