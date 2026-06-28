import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@octopus/db";
import { auth } from "./auth";

/**
 * Boot-time seed: if the database has no users at all, create a first admin
 * account. The password is RANDOM per install (printed once to the boot log),
 * or OCTOPUS_ADMIN_PASSWORD if the operator pins one — nothing is hardcoded.
 * The account is flagged `mustChangePassword=true` so the very first sign-in
 * lands on `/change-password` and can reach no other page until a real
 * password is set.
 *
 * Self-hosted deployments only — gated on NEXT_PUBLIC_OCTOPUS_SELF_HOSTED so a
 * seed admin can never be created on the multi-tenant SaaS (the caller in
 * instrumentation.ts gates this too).
 *
 * Idempotent — runs on every server boot but is a no-op once at least one
 * user exists. Skipped entirely when `DISABLE_ADMIN_SEED=true` for operators
 * who provision users out-of-band.
 *
 * Why this is safe:
 *   1. Only seeded on a *truly empty* user table — never overwrites an
 *      existing account, never resets a real user's password.
 *   2. No shipped default password — random per install, surfaced only in the
 *      operator's boot log (or supplied by them via OCTOPUS_ADMIN_PASSWORD).
 *   3. mustChangePassword is enforced by the (app) layout on every request, so
 *      the seed cred can only ever reach the change-password page.
 *   4. Wiped by Better Auth once the user picks a new password.
 */
// example.com is a reserved domain (RFC 2606) — always passes email validation
// and never collides with a real inbox. Override with OCTOPUS_ADMIN_EMAIL.
const DEFAULT_ADMIN_EMAIL = process.env.OCTOPUS_ADMIN_EMAIL || "admin@example.com";
const DEFAULT_ADMIN_NAME = "Admin";

let bootstrapPromise: Promise<void> | null = null;

export async function bootstrapDefaultAdmin(): Promise<void> {
  // Self-hosted only. Never seed a default admin on the hosted SaaS.
  if (process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED !== "true") return;
  if (process.env.DISABLE_ADMIN_SEED === "true") return;
  // Guard against multiple concurrent invocations during dev hot-reloads.
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      // Self-heal: if the only user is the default admin AND the flag
      // didn't get set (e.g. a previous boot raced or the Prisma client
      // was stale), set it now. Without this the operator's first sign-in
      // wouldn't trigger the forced change.
      if (userCount === 1) {
        const sole = await prisma.user.findFirst({
          where: { email: DEFAULT_ADMIN_EMAIL, mustChangePassword: false },
          select: { id: true },
        });
        if (sole) {
          await prisma.user.update({
            where: { id: sole.id },
            data: { mustChangePassword: true },
          });
          console.log(
            `[bootstrap-admin] patched ${DEFAULT_ADMIN_EMAIL}: mustChangePassword=true`,
          );
        }
      }
      return;
    }

    try {
      // Use Better Auth's signUp.email so the password is hashed with the
      // same algorithm the sign-in flow uses to verify. Going through the
      // server API instead of prisma directly also keeps the `accounts`
      // row (where Better Auth stores the credential hash) in sync.
      // Random per-install password (printed once below), unless the operator
      // pins one via OCTOPUS_ADMIN_PASSWORD. Nothing is hardcoded.
      const envPassword = process.env.OCTOPUS_ADMIN_PASSWORD;
      if (envPassword && envPassword.length < 10) {
        console.error(
          "[bootstrap-admin] OCTOPUS_ADMIN_PASSWORD must be 10+ characters; skipping admin seed.",
        );
        return;
      }
      const adminPassword = envPassword || randomBytes(18).toString("base64url");

      const result = await auth.api.signUpEmail({
        body: {
          email: DEFAULT_ADMIN_EMAIL,
          password: adminPassword,
          name: DEFAULT_ADMIN_NAME,
        },
      });
      const userId = result.user?.id;
      if (!userId) {
        console.error("[bootstrap-admin] signUpEmail returned no user id");
        return;
      }
      await prisma.user.update({
        where: { id: userId },
        data: { mustChangePassword: true, emailVerified: true },
      });
      console.log(
        "[bootstrap-admin] ╔════════════════════════════════════════════════════╗",
      );
      console.log(
        "[bootstrap-admin] ║ First-boot admin account created:                  ║",
      );
      console.log(
        `[bootstrap-admin] ║   email:    ${DEFAULT_ADMIN_EMAIL.padEnd(38)} ║`,
      );
      console.log(
        `[bootstrap-admin] ║   password: ${(envPassword ? "(from OCTOPUS_ADMIN_PASSWORD)" : adminPassword).padEnd(38)} ║`,
      );
      console.log(
        "[bootstrap-admin] ║ You will be forced to change the password on the   ║",
      );
      console.log(
        "[bootstrap-admin] ║ first sign-in. Set DISABLE_ADMIN_SEED=true to skip ║",
      );
      console.log(
        "[bootstrap-admin] ║ this on future fresh installs.                     ║",
      );
      console.log(
        "[bootstrap-admin] ╚════════════════════════════════════════════════════╝",
      );
    } catch (err) {
      // Don't fail boot if the seed errors (e.g. concurrent boots racing
      // the unique constraint). Log and move on; the operator can sign up
      // manually if needed.
      console.error(
        "[bootstrap-admin] failed to seed default admin:",
        err instanceof Error ? err.message : String(err),
      );
    }
  })();

  return bootstrapPromise;
}
