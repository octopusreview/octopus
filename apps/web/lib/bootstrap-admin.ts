import "server-only";
import { prisma } from "@octopus/db";
import { auth } from "./auth";

/**
 * Boot-time seed: if the database has no users at all, create a default
 * admin account with credentials `admin@local` / `admin`. The user is
 * flagged `mustChangePassword=true` so the very first sign-in lands on
 * `/change-password` and they cannot reach any other page until they
 * pick a real password.
 *
 * Idempotent — runs on every server boot but is a no-op once at least
 * one user exists. Skipped entirely when `DISABLE_ADMIN_SEED=true` for
 * operators who provision users out-of-band.
 *
 * Why this is safe despite shipping a default credential:
 *   1. Only seeded on a *truly empty* user table — never overwrites
 *      an existing account, never resets a real user's password.
 *   2. The mustChangePassword flag is enforced by `proxy.ts` for
 *      every authenticated request, so the `admin/admin` cred can
 *      only ever reach the change-password page.
 *   3. Wiped automatically by Better Auth when the user picks a new
 *      password (see /change-password page handler).
 */
// admin@example.com — example.com is a reserved domain (RFC 2606) that
// always passes email validation and never collides with a real inbox.
// The password is intentionally an obvious placeholder; the mustChangePassword
// flag forces a real choice on first sign-in, so this string can never
// actually be used to access any UI beyond /change-password.
const DEFAULT_ADMIN_EMAIL = "admin@example.com";
const DEFAULT_ADMIN_PASSWORD = "change-me-now";
const DEFAULT_ADMIN_NAME = "Admin";

let bootstrapPromise: Promise<void> | null = null;

export async function bootstrapDefaultAdmin(): Promise<void> {
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
      const result = await auth.api.signUpEmail({
        body: {
          email: DEFAULT_ADMIN_EMAIL,
          password: DEFAULT_ADMIN_PASSWORD,
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
        `[bootstrap-admin] ║ First-boot admin account created:                  ║`,
      );
      console.log(
        `[bootstrap-admin] ║   email:    ${DEFAULT_ADMIN_EMAIL.padEnd(38)} ║`,
      );
      console.log(
        `[bootstrap-admin] ║   password: ${DEFAULT_ADMIN_PASSWORD.padEnd(38)} ║`,
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
