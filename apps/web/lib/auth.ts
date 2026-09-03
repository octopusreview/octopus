import { betterAuth } from "better-auth";
import { APIError, getIp } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@octopus/db";
import { sendEmail } from "./email";
import { writeAuditLog } from "./audit";
import { renderEmailTemplate } from "./email-renderer";
import { enqueueAfter } from "./queue";
import { reasonToMessage, validateEmailForSignup } from "./email-validator";
import { normalizeEmail } from "./email-normalize";
import { assertUserNotBanned } from "./session-guard";
import { checkSignupVelocity } from "./signup-velocity";

// Email/password sign-in + sign-up (and the first-boot admin seed) are a
// self-hosted opt-in. On the multi-tenant SaaS, sign-in is OAuth + magic-link.
const IS_SELF_HOSTED = process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true";

export const auth = betterAuth({
  trustedOrigins: [process.env.BETTER_AUTH_URL!],
  // Resolve the client IP from the edge-set, hard-to-spoof header first, then
  // fall back through the proxy chain. This IP feeds audit logs and the
  // signup-abuse (Sybil) signal, so the source must not be the client-set first
  // x-forwarded-for hop. On the SaaS, Cloudflare overwrites cf-connecting-ip so
  // it's authoritative. Self-host operators MUST ensure their reverse proxy
  // sets/overwrites these headers (same caveat as lib/request-ip.ts); an
  // untrusted proxy makes any of them client-spoofable and only weakens the
  // best-effort signal (it can't grant more than the once-per-user bonus).
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"],
    },
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  // The ENTIRE emailAndPassword block is omitted on the SaaS — not merely
  // `enabled: false`. Better Auth gates request/reset-password on the presence
  // of `sendResetPassword`, so leaving the block in (even disabled) would keep
  // those endpoints live. Omitting it keeps all password endpoints fully off.
  ...(IS_SELF_HOSTED
    ? {
        emailAndPassword: {
          enabled: true,
          // Auto-sign-in after sign-up — Better Auth creates the session in the
          // same response, matching the magic-link UX.
          autoSignIn: true,
          // Default is 8; go to 10 so we're not the weakest link self-hosted.
          minPasswordLength: 10,
          sendResetPassword: async ({
            user,
            url,
          }: {
            user: { id: string; email: string };
            url: string;
          }) => {
            const result = await renderEmailTemplate("magic-link", {
              magicLinkUrl: url,
            });
            await sendEmail({
              to: user.email,
              subject: "Reset your Octopus password",
              html:
                result?.html ??
                `<p>Click <a href="${url}">here</a> to reset your Octopus password. The link expires in 1 hour.</p>`,
            });
            await writeAuditLog({
              action: "email.password_reset_sent",
              category: "email",
              actorEmail: user.email,
              targetType: "user",
              targetId: user.id,
              metadata: { recipient: user.email },
            });
          },
        },
        // Default rate limiting is on in production; tighten the unauthenticated
        // password endpoints (self-host only) to curb reset-email spam and
        // credential stuffing. The SaaS is untouched (whole block omitted there).
        rateLimit: {
          customRules: {
            "/request-password-reset": { window: 60, max: 3 },
            "/reset-password": { window: 60, max: 5 },
            "/sign-in/email": { window: 60, max: 10 },
            "/sign-up/email": { window: 3600, max: 5 },
          },
        },
      }
    : {}),
  user: {
    additionalFields: {
      // Declared so the adapter persists the signupIp the user.create.before
      // hook stamps (transformInput drops fields not in the schema). Never
      // client-writable, never returned in API responses.
      signupIp: {
        type: "string",
        required: false,
        input: false,
        returned: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          await assertUserNotBanned(session.userId);
        },
        after: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { email: true },
          });

          // Record the IP of the user's first session as a Sybil signal.
          // updateMany with `signupIp: null` sets it exactly once, race-free.
          if (session.ipAddress) {
            await prisma.user
              .updateMany({
                where: { id: session.userId, signupIp: null },
                data: { signupIp: session.ipAddress },
              })
              .catch((err) =>
                console.error("[auth] failed to record signup IP:", err),
              );
          }

          await writeAuditLog({
            action: "auth.login",
            category: "auth",
            actorId: session.userId,
            actorEmail: user?.email ?? null,
            targetType: "session",
            targetId: session.id,
            ipAddress: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
          });
        },
      },
    },
    user: {
      create: {
        before: async (user, ctx) => {
          const normalizedEmail = normalizeEmail(user.email);

          // If an account already owns the canonical identity, fail with a
          // clear message instead of letting the unique constraint bubble up.
          const canonicalOwner = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true },
          });
          if (canonicalOwner) {
            await writeAuditLog({
              action: "auth.signup_blocked",
              category: "auth",
              actorEmail: normalizedEmail,
              targetType: "user",
              metadata: { reason: "canonical_exists", original: user.email },
            });
            throw new APIError("BAD_REQUEST", {
              message:
                "An account already exists for this email. Please sign in with your existing address.",
            });
          }

          const result = await validateEmailForSignup(normalizedEmail);
          if (!result.ok) {
            await writeAuditLog({
              action: "auth.signup_blocked",
              category: "auth",
              actorEmail: normalizedEmail,
              targetType: "user",
              metadata: { reason: result.reason, original: user.email },
            });
            throw new APIError("BAD_REQUEST", {
              message: reasonToMessage(result.reason),
            });
          }

          // Hard signup-velocity cap (issue #788): unlike the welcome-credit
          // scorer, this BLOCKS user creation. Resolve the IP with better-auth's
          // own getIp + the live options so the string is byte-identical to
          // what session.create.after stamps into signupIp (getIp normalizes:
          // IPv6 is expanded and /64-masked — making the exact-IP cap an
          // effective per-/64 cap — and ::ffff: v4-mapped becomes dotted-quad).
          const requestHeaders = ctx?.headers ?? ctx?.request?.headers;
          const ip =
            ctx && requestHeaders
              ? getIp(new Headers(requestHeaders), ctx.context.options)
              : null;
          const velocity = await checkSignupVelocity(ip);
          if (velocity.blocked) {
            await writeAuditLog({
              action: "auth.signup_blocked_velocity",
              category: "auth",
              actorEmail: normalizedEmail,
              targetType: "user",
              ipAddress: ip,
              metadata: {
                reason: velocity.reason,
                ip,
                ipCount: velocity.ipCount,
                subnetCount: velocity.subnetCount,
              },
            });
            throw new APIError("TOO_MANY_REQUESTS", {
              message:
                "Too many sign-ups from this network today. Please try again tomorrow or contact support.",
            });
          }

          // Stamp signupIp at create time, not only at first session, so the
          // velocity count sees users who never open a session and a parallel
          // burst of verifies can only overshoot the cap by the concurrent
          // INSERT window (milliseconds), not the whole burst.
          // session.create.after's set-once update guards on `signupIp: null`,
          // so rows created before this change keep first-session semantics.
          return {
            data: {
              ...user,
              email: normalizedEmail,
              ...(ip ? { signupIp: ip } : {}),
            },
          };
        },
        after: async (user) => {
          await writeAuditLog({
            action: "auth.signup",
            category: "auth",
            actorId: user.id,
            actorEmail: user.email,
            targetType: "user",
            targetId: user.id,
          });

          // Queue welcome email — 1 hour after signup
          enqueueAfter(
            "welcome-email",
            { userId: user.id, email: user.email, name: user.name },
            60 * 60, // 1 hour in seconds
          ).catch((err) =>
            console.error("[auth] Failed to enqueue welcome email:", err),
          );
        },
      },
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const normalizedEmail = normalizeEmail(email);
        const rawLookupEmail = email.trim().toLowerCase();
        let existing = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: { id: true },
        });
        // Fallback for legacy accounts registered before normalization landed,
        // whose stored email is still in the dotted/aliased form.
        if (!existing && rawLookupEmail !== normalizedEmail) {
          existing = await prisma.user.findUnique({
            where: { email: rawLookupEmail },
            select: { id: true },
          });
        }
        if (!existing) {
          const validation = await validateEmailForSignup(normalizedEmail);
          if (!validation.ok) {
            await writeAuditLog({
              action: "auth.signup_blocked",
              category: "auth",
              actorEmail: normalizedEmail,
              targetType: "user",
              metadata: {
                reason: validation.reason,
                source: "magic_link",
                original: email,
              },
            });
            throw new APIError("BAD_REQUEST", {
              message: reasonToMessage(validation.reason),
            });
          }
        }

        const result = await renderEmailTemplate("magic-link", {
          magicLinkUrl: url,
        });

        await sendEmail({
          to: email,
          subject: result?.subject ?? "Sign in to Octopus",
          html:
            result?.html ??
            `<p>Click <a href="${url}">here</a> to sign in to Octopus.</p>`,
        });
        await writeAuditLog({
          action: "email.magic_link_sent",
          category: "email",
          actorEmail: normalizedEmail,
          targetType: "user",
          metadata: { recipient: email },
        });
      },
    }),
  ],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    ...(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
      ? {
          microsoft: {
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            tenantId: process.env.MICROSOFT_TENANT_ID ?? "common",
            // Override the default user-info extraction so we can resolve a real
            // email when the ID token's `email` claim is missing (Entra ID does
            // not emit it unless the optional claim is configured AND the user
            // has a mailbox). Resolution order: id_token.email → Microsoft Graph
            // /me.mail → preferred_username/upn (last resort, may be a UPN that
            // is not a deliverable mailbox).
            getUserInfo: async (token) => {
              if (!token.idToken) return null;
              const parts = token.idToken.split(".");
              if (parts.length !== 3 || !parts[1]) return null;
              const payload = JSON.parse(
                Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
              );

              let email: string | undefined = payload.email;
              let emailIsVerifiedMailbox = !!payload.email;
              if (!email && token.accessToken) {
                try {
                  const res = await fetch(
                    "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName,id",
                    { headers: { Authorization: `Bearer ${token.accessToken}` } },
                  );
                  if (res.ok) {
                    const me = (await res.json()) as { mail?: string; userPrincipalName?: string };
                    if (me.mail) {
                      email = me.mail;
                      emailIsVerifiedMailbox = true;
                    }
                  } else {
                    console.warn(`[auth] Microsoft Graph /me returned ${res.status}`);
                  }
                } catch (e) {
                  console.warn("[auth] Microsoft Graph /me fetch failed:", e);
                }
              }
              email = email ?? payload.preferred_username ?? payload.upn;
              if (!email) return null;

              return {
                user: {
                  id: payload.sub,
                  name: payload.name,
                  email,
                  emailVerified: payload.email_verified === true || emailIsVerifiedMailbox,
                  image: undefined,
                },
                data: payload,
              };
            },
          },
        }
      : {}),
  },
  account: {
    accountLinking: {
      enabled: true,
      // Auto-link a new social sign-in to an existing user when emails match.
      // Restricted to providers whose email is verified at the IdP (Google,
      // GitHub, Microsoft work accounts via Graph mail) so we can't be tricked
      // into linking by an attacker who controls an unverified email.
      trustedProviders: ["google", "github", "microsoft"],
    },
  },
});


