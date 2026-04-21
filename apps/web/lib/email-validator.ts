import { promises as dns } from "node:dns";
import disposableDomains from "disposable-domains";
import { getRedis } from "./redis";

const DISPOSABLE_LIST = disposableDomains as string[];
const DISPOSABLE_SET = new Set<string>(DISPOSABLE_LIST);

const DISPOSABLE_MX_SUFFIXES = [
  "den.yt",
  "mail.tm",
  "mailinator.com",
  "guerrillamail.com",
  "yopmail.com",
  "tempmail.dev",
  "maildrop.cc",
  "dropmail.me",
  "fakemailgenerator.com",
  "temp-mail.org",
  "tmmbt.net",
  "emailondeck.com",
];

type MxCheckResult = "valid" | "invalid" | "disposable_mx";
type MxCacheEntry = { result: MxCheckResult; expiresAt: number };
const MX_CACHE = new Map<string, MxCacheEntry>();
const MX_CACHE_TTL_SECONDS = 24 * 60 * 60;
const MX_LOOKUP_TIMEOUT_MS = 2000;
const MX_CACHE_KEY_PREFIX = "mx:v1:";

const VALID_RESULTS: readonly MxCheckResult[] = ["valid", "invalid", "disposable_mx"];

async function readMxCache(domain: string): Promise<MxCheckResult | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const val = await redis.get(MX_CACHE_KEY_PREFIX + domain);
      if (val && (VALID_RESULTS as readonly string[]).includes(val)) {
        return val as MxCheckResult;
      }
    } catch (err) {
      console.error("[email-validator] redis get failed:", (err as Error).message);
    }
  }
  const entry = MX_CACHE.get(domain);
  if (entry && entry.expiresAt > Date.now()) return entry.result;
  return null;
}

async function writeMxCache(domain: string, result: MxCheckResult): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(
        MX_CACHE_KEY_PREFIX + domain,
        result,
        "EX",
        MX_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      console.error("[email-validator] redis set failed:", (err as Error).message);
    }
  }
  MX_CACHE.set(domain, {
    result,
    expiresAt: Date.now() + MX_CACHE_TTL_SECONDS * 1000,
  });
}

export type EmailValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid_format" | "disposable" | "disposable_mx" | "no_mx";
    };

function extractDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

export function isDisposableDomain(domain: string): boolean {
  const normalized = domain.toLowerCase().replace(/\.$/, "");
  if (DISPOSABLE_SET.has(normalized)) return true;
  return DISPOSABLE_LIST.some((d) => normalized.endsWith("." + d));
}

function isDisposableMxHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return DISPOSABLE_MX_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith("." + suffix),
  );
}

export async function checkMx(domain: string): Promise<MxCheckResult> {
  const cached = await readMxCache(domain);
  if (cached) return cached;

  // Fail-open on timeout or transient DNS errors. Only definitive answers
  // (NXDOMAIN, empty MX, or a hit on the disposable-MX suffix list) block signup.
  const result = await Promise.race<MxCheckResult>([
    dns
      .resolveMx(domain)
      .then<MxCheckResult>((records) => {
        if (records.length === 0) return "invalid";
        if (records.some((r) => isDisposableMxHost(r.exchange)))
          return "disposable_mx";
        return "valid";
      })
      .catch((err: NodeJS.ErrnoException): MxCheckResult => {
        if (err.code === "ENOTFOUND" || err.code === "ENODATA")
          return "invalid";
        return "valid";
      }),
    new Promise<MxCheckResult>((resolve) =>
      setTimeout(() => resolve("valid"), MX_LOOKUP_TIMEOUT_MS),
    ),
  ]);

  await writeMxCache(domain, result);
  return result;
}

export async function validateEmailForSignup(
  email: string,
): Promise<EmailValidationResult> {
  const domain = extractDomain(email);
  if (!domain) return { ok: false, reason: "invalid_format" };
  if (isDisposableDomain(domain)) return { ok: false, reason: "disposable" };

  const mx = await checkMx(domain);
  if (mx === "disposable_mx") return { ok: false, reason: "disposable_mx" };
  if (mx === "invalid") return { ok: false, reason: "no_mx" };

  return { ok: true };
}

export function reasonToMessage(
  reason: Exclude<EmailValidationResult, { ok: true }>["reason"],
): string {
  switch (reason) {
    case "disposable":
    case "disposable_mx":
      return "Disposable email addresses are not allowed.";
    case "no_mx":
      return "This email domain cannot receive mail.";
    case "invalid_format":
      return "Invalid email address.";
  }
}
