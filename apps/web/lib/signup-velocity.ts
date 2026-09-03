import { prisma } from "@octopus/db";

/**
 * Hard signup-velocity cap — a pre-create BLOCK, unlike the welcome-credit
 * scorer which only withholds the bonus. Runs in auth.ts
 * `databaseHooks.user.create.before` (covers magic link AND OAuth) and counts
 * existing users whose signupIp matches the requester's IP (exact, then /24)
 * over the last 24h. The signup-farm post-mortem (issue #788): 94 hosting IPs
 * at ~120 signups each sailed past every per-request limiter; this bounds
 * accounts-per-IP-per-day instead of requests-per-minute.
 *
 * Kill switch: SIGNUP_VELOCITY_CAP=off. Caps env-tunable via
 * SIGNUP_MAX_PER_IP_DAY (default 5) and SIGNUP_MAX_PER_SUBNET_DAY (default 15).
 * No IP, or a private/loopback IP (self-host behind an unset proxy), skips the
 * cap entirely — never punish an absent signal.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Private / loopback / link-local ranges (v4 + v6) where velocity is
 * meaningless. The caller passes better-auth's getIp() output, so IPv6
 * arrives expanded and /64-masked — ::1 / :: reach us as the all-zeros form,
 * hence the `0000:...` prefix alongside the raw `::1` (kept for direct calls).
 */
const PRIVATE_IP_RE =
  /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|0000:0000:0000:0000:|f[cd][0-9a-f]{2}:|fe80:)/i;

/** "94.23.11.7" → "94.23.11." — null for anything that isn't dotted-quad IPv4. */
function ipv4Prefix24(ip: string): string | null {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  return m ? `${m[1]}.` : null;
}

export type SignupVelocityResult =
  | { blocked: false }
  | {
      blocked: true;
      reason: "ip" | "subnet";
      ipCount: number;
      subnetCount: number | null;
    };

/**
 * Decide whether a signup from `ip` exceeds the 24h velocity caps.
 * `blocked: true` means the caller must reject the user creation.
 */
export async function checkSignupVelocity(
  ip: string | null | undefined,
): Promise<SignupVelocityResult> {
  if (process.env.SIGNUP_VELOCITY_CAP === "off") return { blocked: false };
  if (!ip || PRIVATE_IP_RE.test(ip)) return { blocked: false };

  const since = new Date(Date.now() - WINDOW_MS);
  const ipCount = await prisma.user.count({
    where: { signupIp: ip, createdAt: { gte: since } },
  });
  if (ipCount >= envInt("SIGNUP_MAX_PER_IP_DAY", 5)) {
    return { blocked: true, reason: "ip", ipCount, subnetCount: null };
  }

  // For IPv6 the exact match above is already a /64 cap: the caller feeds us
  // better-auth's getIp() output, which masks IPv6 to its /64.
  const prefix = ipv4Prefix24(ip);
  if (!prefix) return { blocked: false }; // ponytail: no v6 subnet query; add a /48 rule if v6 farms show up

  const subnetCount = await prisma.user.count({
    where: { signupIp: { startsWith: prefix }, createdAt: { gte: since } },
  });
  if (subnetCount >= envInt("SIGNUP_MAX_PER_SUBNET_DAY", 15)) {
    return { blocked: true, reason: "subnet", ipCount, subnetCount };
  }

  return { blocked: false };
}
