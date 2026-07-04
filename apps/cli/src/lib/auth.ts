import { spawn } from "node:child_process";
import { postJson } from "./api.js";
import type { Credentials } from "./credentials.js";

/**
 * Headless auth for the operational commands. Extracted so `login`,
 * `setup-token`, and the onboarding wizard share one device-flow
 * implementation. Endpoints:
 *   POST /api/cli/auth/device        → { deviceCode, expiresAt }
 *   GET  /api/cli/auth/poll?...      → { status, token, organization, user }
 *   POST /api/cli/auth/verify        → { user, organization }   (token paste)
 */

const MAX_POLL_ATTEMPTS = 200;
const POLL_INTERVAL_MS = 2000;
const REQUEST_TIMEOUT_MS = 15_000;

export const TOKEN_PREFIX = "oct_";

export function isValidTokenFormat(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX) && token.length > TOKEN_PREFIX.length;
}

export interface AuthIdentity {
  token: string;
  organization: { id: string; slug: string; name: string };
  user: { name: string; email: string };
}

export interface DeviceFlowOptions {
  /** Don't open the browser automatically (the URL is still surfaced via onAuthorizeUrl). */
  noOpen?: boolean;
  /** Receives the authorize URL — callers decide stdout vs stderr vs silent. */
  onAuthorizeUrl?: (url: string) => void;
}

/**
 * Open a URL in the default browser WITHOUT a shell. We spawn with an args
 * array (shell:false is the spawn default) so a crafted base URL or device
 * code cannot inject shell commands. The old standalone CLI used
 * `exec("open \"" + url + "\"")` — string interpolation into a shell, a
 * command-injection vector. Best-effort: the URL is also printed for manual
 * open, so a spawn failure is non-fatal.
 *
 * Resolves `true` once the browser process spawns successfully and `false`
 * if it never launches (bad URL, missing opener, spawn throw) so callers can
 * distinguish "opened" from "here's the URL, open it yourself".
 */
export function openBrowser(url: string): Promise<boolean> {
  try {
    new URL(url);
  } catch {
    return Promise.resolve(false);
  }
  let cmd: string;
  let args: string[];
  if (process.platform === "win32") {
    // `cmd /c start "" <url>` — url is a discrete argv entry, never spliced
    // into a shell string. The empty "" is start's window-title placeholder.
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false)); // ENOENT (no xdg-open) etc. — URL is printed
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false); // URL was surfaced for manual open
    }
  });
}

export async function runDeviceFlow(
  baseUrl: string,
  options: DeviceFlowOptions = {},
): Promise<AuthIdentity> {
  const { noOpen = false, onAuthorizeUrl } = options;

  let deviceRes: Response;
  try {
    deviceRes = await fetch(`${baseUrl}/api/cli/auth/device`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`Could not reach ${baseUrl} — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!deviceRes.ok) {
    if (deviceRes.status === 404) {
      throw new Error("Device authorization endpoint not found. Is the server up to date?");
    }
    if (deviceRes.status === 429) {
      throw new Error("Too many login attempts. Wait a minute and try again.");
    }
    throw new Error(`Failed to initiate login (HTTP ${deviceRes.status}).`);
  }

  const deviceData = (await deviceRes.json()) as Record<string, unknown>;
  const deviceCode = deviceData.deviceCode;
  const expiresAt = deviceData.expiresAt;
  if (typeof deviceCode !== "string" || typeof expiresAt !== "string") {
    throw new Error("Invalid response from device authorization endpoint.");
  }

  const authorizeUrl = `${baseUrl}/cli/authorize?code=${encodeURIComponent(deviceCode)}`;
  onAuthorizeUrl?.(authorizeUrl);
  if (!noOpen) void openBrowser(authorizeUrl);

  const expiry = new Date(expiresAt).getTime();
  let attempts = 0;
  let networkErrors = 0;
  while (attempts < MAX_POLL_ATTEMPTS) {
    if (Number.isFinite(expiry) && Date.now() > expiry) {
      throw new Error("Authorization timed out. Please try again.");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    attempts++;

    let pollRes: Response;
    try {
      pollRes = await fetch(
        `${baseUrl}/api/cli/auth/poll?device_code=${encodeURIComponent(deviceCode)}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch (e) {
      networkErrors++;
      if (networkErrors > 5) {
        throw new Error(
          `Network error during authorization: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      continue;
    }
    if (pollRes.status === 410) throw new Error("Authorization expired. Please try again.");
    if (!pollRes.ok) continue;

    const data = (await pollRes.json()) as {
      status?: string;
      token?: string;
      organization?: { id: string; slug: string; name: string };
      user?: { name?: string; email?: string };
    };
    if (data.status === "approved" && data.token && data.organization) {
      return {
        token: data.token,
        organization: data.organization,
        user: { name: data.user?.name ?? "Unknown User", email: data.user?.email ?? "" },
      };
    }
  }
  throw new Error("Authorization timed out after too many attempts.");
}

/** Verify a pasted `oct_` token against the server; returns the org/user it maps to. */
export async function verifyToken(
  baseUrl: string,
  token: string,
): Promise<{ organization: { id: string; slug: string; name: string }; user: { name: string; email: string } }> {
  const res = await postJson<{
    user: { id: string; name: string; email: string };
    organization: { id: string; name: string; slug: string };
  }>(`${baseUrl}/api/cli/auth/verify`, {}, token, { timeoutMs: REQUEST_TIMEOUT_MS });
  if (!res.ok) throw new Error(res.error || "Invalid token");
  return {
    organization: res.data.organization,
    user: { name: res.data.user.name, email: res.data.user.email },
  };
}

/** Assemble a Credentials record from a completed auth + base URL. */
export function buildCredentials(baseUrl: string, id: AuthIdentity): Credentials {
  return {
    baseUrl,
    token: id.token,
    orgId: id.organization.id,
    orgSlug: id.organization.slug,
    orgName: id.organization.name,
    userName: id.user.name || undefined,
    userEmail: id.user.email || undefined,
    approvedAt: new Date().toISOString(),
  };
}
