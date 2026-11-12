import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
// Only global unicast IPv6, excluding special-purpose and transition ranges.
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}
const privateNetwork = new BlockList();
for (const [address, prefix] of [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["100.64.0.0", 10]] as const) {
  privateNetwork.addSubnet(address, prefix, "ipv4");
}
privateNetwork.addSubnet("fc00::", 7, "ipv6");
const metadata = new BlockList();
metadata.addAddress("100.100.100.200", "ipv4"); // Alibaba Cloud, inside CGNAT.
metadata.addAddress("fd00:ec2::254", "ipv6"); // AWS IMDS, inside unique-local IPv6.

export function isPublicForgejoAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

function parseHost(value: string): URL {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a valid Forgejo HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || url.pathname !== "/" || !url.hostname) {
    throw new Error("Forgejo requires an HTTPS origin without credentials, a path, query, or fragment");
  }
  return url;
}

function addressAllowed(address: string, allowPrivate: boolean): boolean {
  if (metadata.check(address, isIP(address) === 4 ? "ipv4" : "ipv6")) return false;
  return isPublicForgejoAddress(address) || (allowPrivate && (isIP(address) === 4
    ? privateNetwork.check(address, "ipv4") : isIP(address) === 6 && privateNetwork.check(address, "ipv6")));
}

const networkError = () => new Error("Use public HTTPS for a direct Octopus Cloud connection, a local connector for private LAN/VPN access from Cloud, or an origin explicitly allowed in FORGEJO_ALLOWED_PRIVATE_ORIGINS for direct private access from self-hosted Octopus. Loopback, link-local, metadata and reserved addresses are not supported.");

export function normalizeForgejoHost(value: string, options: { allowPrivate?: boolean } = {}): string {
  const url = parseHost(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) && !addressAllowed(hostname, options.allowPrivate === true)) throw networkError();
  return url.origin;
}

export class ForgejoHttpError extends Error {
  constructor(public readonly status: number) { super(`Forgejo API request failed (${status})`); }
}

export class ForgejoResponseTooLargeError extends Error {
  constructor() { super("Forgejo response exceeds the fetch budget"); }
}

/** Resolve once and pin the validated address to this TLS connection.
 * The caller must explicitly opt in to private addresses for an operator-selected
 * origin. No redirects or proxy environment variables are used. */
export async function forgejoRequest(host: string, token: string, path: string, options: {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
  maxBytes?: number;
  allowPrivate?: boolean;
} = {}): Promise<{ body: string; headers: IncomingHttpHeaders }> {
  const origin = normalizeForgejoHost(host, options);
  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith("/api/v1/") || url.hash || url.username || url.password) {
    throw new Error("Invalid Forgejo API path");
  }
  if (!token || /[\r\n]/.test(token)) throw new Error("Invalid Forgejo access token");
  const serializedBody = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (serializedBody !== undefined && Buffer.byteLength(serializedBody) > 1024 * 1024) throw new Error("Forgejo request exceeds the fetch budget");
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 16 * 1024 * 1024) throw new Error("Invalid Forgejo response budget");
  let onAbort: () => void = () => {};
  try {
    const addresses = await Promise.race([
      isIP(hostname) ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
        : lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("Forgejo request cancelled or timed out"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
    if (addresses.length === 0 || addresses.some(({ address }) => !addressAllowed(address, options.allowPrivate === true))) {
      throw networkError();
    }
    signal.throwIfAborted();
    const pinned = addresses[0];
    return await new Promise((resolve, reject) => {
      const req = request(url, {
        method: options.method ?? "GET", signal, agent: false, family: pinned.family, rejectUnauthorized: true,
        // Match DNS callback timing so Node attaches socket error handlers before connecting.
        lookup: (_hostname, lookupOptions, callback) => queueMicrotask(() => {
          if (lookupOptions.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        }),
        headers: { Authorization: `token ${token}`, Accept: "application/json", "Accept-Encoding": "identity",
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      }, response => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.destroy(); reject(new ForgejoHttpError(status)); return;
        }
        if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
          response.destroy(); reject(new Error("Unsupported Forgejo response encoding")); return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            response.destroy(); reject(new ForgejoResponseTooLargeError()); return;
          }
          chunks.push(chunk);
        });
        response.on("error", () => reject(new Error("Forgejo response interrupted")));
        response.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), headers: response.headers }));
      });
      // Never expose request objects, tokens, or an untrusted response body in errors.
      req.on("error", () => reject(new Error("Forgejo request failed or timed out")));
      req.end(serializedBody);
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
