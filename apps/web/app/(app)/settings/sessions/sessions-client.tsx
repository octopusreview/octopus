"use client";

import { useState } from "react";
import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconBrandChrome,
  IconBrandFirefox,
  IconBrandSafari,
  IconBrandEdge,
  IconWorld,
  IconTrash,
  IconShieldCheck,
  IconLogout,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { revokeSessionAction, revokeOtherSessionsAction } from "./actions";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface SessionItem {
  id: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

interface SessionsClientProps {
  sessions: SessionItem[];
  currentSessionToken: string;
}

function parseUserAgent(ua: string | null) {
  if (!ua) return { browser: "Unknown", os: "Unknown", isMobile: false };

  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);

  let browser = "Unknown";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
  else if (ua.includes("Chrome/") && !ua.includes("Edg/")) browser = "Chrome";
  else if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";

  let os = "Unknown";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("Linux") && !ua.includes("Android")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

  return { browser, os, isMobile };
}

function BrowserIcon({ browser }: { browser: string }) {
  switch (browser) {
    case "Chrome":
      return <IconBrandChrome className="size-5 text-muted-foreground" />;
    case "Firefox":
      return <IconBrandFirefox className="size-5 text-muted-foreground" />;
    case "Safari":
      return <IconBrandSafari className="size-5 text-muted-foreground" />;
    case "Edge":
      return <IconBrandEdge className="size-5 text-muted-foreground" />;
    default:
      return <IconWorld className="size-5 text-muted-foreground" />;
  }
}

export function SessionsClient({
  sessions,
  currentSessionToken,
}: SessionsClientProps) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const otherSessions = sessions.filter(
    (s) => s.token !== currentSessionToken
  );
  const currentSession = sessions.find(
    (s) => s.token === currentSessionToken
  );

  async function handleRevoke(token: string) {
    setRevoking(token);
    try {
      const formData = new FormData();
      formData.set("token", token);
      const result = await revokeSessionAction(formData);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Session disconnected");
      }
    } catch {
      toast.error("Failed to disconnect session");
    } finally {
      setRevoking(null);
    }
  }

  async function handleRevokeAll() {
    setRevokingAll(true);
    try {
      const result = await revokeOtherSessionsAction();
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("All other sessions disconnected");
      }
    } catch {
      toast.error("Failed to disconnect sessions");
    } finally {
      setRevokingAll(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Current session */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">
          Current Session
        </h3>
        {currentSession && (
          <SessionCard session={currentSession} isCurrent />
        )}
      </div>

      {/* Other sessions */}
      {otherSessions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-foreground">
              Other Sessions ({otherSessions.length})
            </h3>
            <button
              onClick={handleRevokeAll}
              disabled={revokingAll}
              className="flex items-center gap-1.5 text-xs font-medium text-destructive hover:text-destructive/80 disabled:opacity-50 transition-colors"
            >
              <IconLogout className="size-3.5" />
              {revokingAll ? "Disconnecting..." : "Disconnect all"}
            </button>
          </div>
          <div className="space-y-2">
            {otherSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isCurrent={false}
                onRevoke={() => handleRevoke(session.token)}
                isRevoking={revoking === session.token}
              />
            ))}
          </div>
        </div>
      )}

      {otherSessions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No other active sessions.
        </p>
      )}
    </div>
  );
}

function SessionCard({
  session,
  isCurrent,
  onRevoke,
  isRevoking,
}: {
  session: SessionItem;
  isCurrent: boolean;
  onRevoke?: () => void;
  isRevoking?: boolean;
}) {
  const { browser, os, isMobile } = parseUserAgent(session.userAgent);
  const DeviceIcon = isMobile ? IconDeviceMobile : IconDeviceDesktop;

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <DeviceIcon className="size-5 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <BrowserIcon browser={browser} />
            <span className="text-sm font-medium text-foreground">
              {browser} on {os}
            </span>
          </div>
          {isCurrent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <IconShieldCheck className="size-3" />
              This device
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {session.ipAddress && <span>IP: {session.ipAddress}</span>}
          <span>
            Last activity:{" "}
            {timeAgo(session.updatedAt)}
          </span>
          <span>
            Created:{" "}
            {timeAgo(session.createdAt)}
          </span>
        </div>
      </div>

      {!isCurrent && onRevoke && (
        <button
          onClick={onRevoke}
          disabled={isRevoking}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
          title="Disconnect this session"
        >
          <IconTrash className="size-3.5" />
          {isRevoking ? "..." : "Disconnect"}
        </button>
      )}
    </div>
  );
}
