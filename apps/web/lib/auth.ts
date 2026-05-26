import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@octopus/db";
import { sendEmail } from "./email";
import { writeAuditLog } from "./audit";
import { renderEmailTemplate } from "./email-renderer";
import { enqueueAfter } from "./queue";
import { reasonToMessage, validateEmailForSignup } from "./email-validator";
import { normalizeEmail } from "./email-normalize";

export const auth = betterAuth({
  trustedOrigins: [process.env.BETTER_AUTH_URL!],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { email: true },
          });

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
        before: async (user) => {
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
          return { data: { ...user, email: normalizedEmail } };
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
              if (!email && token.accessToken) {
                try {
                  const res = await fetch(
                    "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName,id",
                    { headers: { Authorization: `Bearer ${token.accessToken}` } },
                  );
                  if (res.ok) {
                    const me = (await res.json()) as { mail?: string; userPrincipalName?: string };
                    email = me.mail ?? undefined;
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
                  emailVerified: payload.email_verified === true,
                  image: undefined,
                },
                data: payload,
              };
            },
          },
        }
      : {}),
  },
});


