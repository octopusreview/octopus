"use client";

import { useCallback, useEffect, useState } from "react";
import { getPubbyClient } from "@/lib/pubby-client";

const POLL_MS = 10_000;
const MAX_FEED = 200;

type FeedEvent = {
  id: string;
  action: string;
  target: string | null;
  actorType: string;
  actorId: string | null;
  actorLabel: string | null;
  createdAt: string;
};

type Member = {
  userId: string;
  name: string;
  image: string | null;
  currentActivity: string | null;
  lastSeenAt: number;
};

type Agent = { id: string; name: string; capabilities: unknown; lastSeenAt: number | null };

export function MonitorClient({
  orgId,
  pubbyEnabled,
  initialEvents,
}: {
  orgId: string;
  pubbyEnabled: boolean;
  initialEvents: FeedEvent[];
}) {
  const [events, setEvents] = useState<FeedEvent[]>(initialEvents);
  const [members, setMembers] = useState<Member[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  // Merge incoming events by id, newest-first, capped.
  const mergeEvents = useCallback((incoming: FeedEvent[]) => {
    setEvents((prev) => {
      const byId = new Map(prev.map((e) => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      return [...byId.values()]
        .sort((a, b) =>
          a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
        )
        .slice(0, MAX_FEED);
    });
  }, []);

  const pollFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { events?: FeedEvent[]; active?: boolean };
      // Telemetry disabled mid-session → clear the feed (don't show stale events).
      if (data.active === false) {
        setEvents([]);
        return;
      }
      if (data.events) mergeEvents(data.events);
    } catch {
      /* transient — next tick retries */
    }
  }, [mergeEvents]);

  const pollRoster = useCallback(async () => {
    try {
      const res = await fetch("/api/presence", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { members?: Member[]; agents?: Agent[] };
      setMembers(data.members ?? []);
      setAgents(data.agents ?? []);
    } catch {
      /* transient */
    }
  }, []);

  // Poll roster + feed on an interval (presence is never pushed; the feed poll
  // also reconciles any dropped real-time pushes).
  useEffect(() => {
    void pollRoster();
    void pollFeed();
    const t = setInterval(() => {
      void pollRoster();
      void pollFeed();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pollRoster, pollFeed]);

  // Live feed via Pubby (when configured): a push just nudges a feed re-fetch so
  // the DB stays the source of truth (ids/dedup/ordering are authoritative).
  // pollFeed is a stable useCallback, so this subscribes once per org.
  useEffect(() => {
    if (!pubbyEnabled) return;
    const pubby = getPubbyClient();
    const channelName = `private-telemetry-org-${orgId}`;
    const channel = pubby.subscribe(channelName);
    const onActivity = () => void pollFeed();
    channel.bind("activity", onActivity);
    return () => {
      channel.unbind("activity", onActivity);
      pubby.unsubscribe(channelName);
    };
  }, [orgId, pubbyEnabled, pollFeed]);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <Panel title={`Online now (${members.length + agents.length})`}>
        {members.length === 0 && agents.length === 0 ? (
          <Empty>No one is online right now.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={`u-${m.userId}`} className="flex items-center justify-between gap-3 py-2">
                <span className="flex items-center gap-2 overflow-hidden">
                  <Dot online />
                  <span className="truncate text-sm">{m.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {m.currentActivity ?? "—"}
                </span>
              </li>
            ))}
            {agents.map((a) => (
              <li key={`a-${a.id}`} className="flex items-center justify-between gap-3 py-2">
                <span className="flex items-center gap-2 overflow-hidden">
                  <Dot online />
                  <span className="truncate text-sm">{a.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">agent</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Activity">
        {events.length === 0 ? (
          <Empty>No recent activity.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex items-center gap-2 overflow-hidden">
                  <ActorBadge type={e.actorType} />
                  <span className="truncate text-sm">
                    <span className="font-medium">{e.action}</span>
                    {e.target ? <span className="text-muted-foreground"> · {e.target}</span> : null}
                  </span>
                </span>
                <time className="shrink-0 text-xs text-muted-foreground">
                  {new Date(e.createdAt).toLocaleTimeString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="border-b border-border px-4 py-2 text-sm font-medium">{title}</header>
      <div className="max-h-[28rem] overflow-y-auto px-4 py-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function Dot({ online }: { online: boolean }) {
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${online ? "bg-green-500" : "bg-muted-foreground/40"}`}
      aria-hidden
    />
  );
}

function ActorBadge({ type }: { type: string }) {
  const label = type === "user" ? "user" : type === "agent" ? "agent" : "system";
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
      {label}
    </span>
  );
}
