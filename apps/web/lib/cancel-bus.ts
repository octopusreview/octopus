import Redis from "ioredis";

type CancelKind = "analysis" | "indexing";
type Handler = (repoId: string) => void;

const CHANNEL = "octopus:cancel";

const handlers: Record<CancelKind, Set<Handler>> = {
  analysis: new Set(),
  indexing: new Set(),
};

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let subscribed = false;

function getPublisher(): Redis | null {
  if (publisher) return publisher;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  publisher = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false });
  publisher.on("error", (err) => console.error("[cancel-bus] publisher error:", err.message));
  return publisher;
}

function ensureSubscribed() {
  if (subscribed) return;
  const url = process.env.REDIS_URL;
  if (!url) return;
  subscriber = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });
  subscriber.on("error", (err) => console.error("[cancel-bus] subscriber error:", err.message));
  subscriber.subscribe(CHANNEL).catch((err) => console.error("[cancel-bus] subscribe failed:", err));
  subscriber.on("message", (_channel, raw) => {
    try {
      const msg = JSON.parse(raw) as { kind?: CancelKind; repoId?: string };
      if (!msg.kind || !msg.repoId) return;
      const set = handlers[msg.kind];
      if (!set) return;
      for (const h of set) {
        try { h(msg.repoId); } catch (err) { console.error("[cancel-bus] handler error:", err); }
      }
    } catch (err) {
      console.error("[cancel-bus] parse error:", err);
    }
  });
  subscribed = true;
}

export function onCancel(kind: CancelKind, handler: Handler): () => void {
  ensureSubscribed();
  handlers[kind].add(handler);
  return () => handlers[kind].delete(handler);
}

export function publishCancel(kind: CancelKind, repoId: string) {
  const pub = getPublisher();
  if (!pub) return;
  pub.publish(CHANNEL, JSON.stringify({ kind, repoId })).catch((err) =>
    console.error("[cancel-bus] publish failed:", err.message),
  );
}
