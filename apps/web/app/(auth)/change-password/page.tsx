"use client";

import * as React from "react";
import Image from "next/image";
import Link from "@/components/link";
import { useRouter } from "next/navigation";
import { changePassword, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { IconLock, IconShieldCheck } from "@tabler/icons-react";

/**
 * Forced password change. Reached when the (app) layout sees
 * `user.mustChangePassword === true` and redirects here. Same surface for
 * the seeded admin@example.com / change-me-now first-sign-in and any user an
 * operator flags to reset.
 *
 * Server-side, the (app) layout enforces the redirect on every request.
 * Once the new password is accepted, Better Auth's changePassword endpoint
 * clears the credential hash; we then PATCH /api/me/password-changed to
 * clear the mustChangePassword flag and redirect into the app.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // No session? Bounce to login. We can't change a password without one.
  React.useEffect(() => {
    if (!isPending && !session) router.replace("/login");
  }, [isPending, session, router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const currentPassword = (formData.get("currentPassword") as string) || "";
    const newPassword = (formData.get("newPassword") as string) || "";
    const confirmPassword = (formData.get("confirmPassword") as string) || "";

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      setLoading(false);
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from the current one.");
      setLoading(false);
      return;
    }

    const { error: changeErr } = await changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (changeErr) {
      setError(changeErr.message ?? "Could not change password.");
      setLoading(false);
      return;
    }

    // Clear the mustChangePassword flag server-side.
    const res = await fetch("/api/me/password-changed", { method: "POST" });
    if (!res.ok) {
      setError("Password changed, but couldn't clear the must-change flag. Try refreshing.");
      setLoading(false);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-[#0c0c0c] text-[#a0a0a0]">
      <div className="w-full max-w-sm px-8">
        <Link
          href="/"
          className="mb-10 flex items-center gap-3 transition-opacity hover:opacity-80"
        >
          <Image src="/logo.svg" alt="Octopus" width={36} height={38} priority />
          <span className="text-xl font-bold tracking-tight text-white">Octopus</span>
        </Link>

        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-900/30 bg-amber-950/10 p-3 text-xs text-amber-200">
          <IconShieldCheck className="mt-0.5 size-4 shrink-0" />
          <p>
            Pick a new password before continuing. The default credential is
            disabled the moment you save.
          </p>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-white">
          Change your password
        </h1>
        <p className="mt-2 text-sm text-[#666]">
          {session?.user?.email ? `Signed in as ${session.user.email}.` : ""}
        </p>

        <form onSubmit={handleSubmit} className="mt-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="currentPassword" className="text-[#888]">
                Current password
              </FieldLabel>
              <div className="relative">
                <IconLock className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#555]" />
                <Input
                  id="currentPassword"
                  name="currentPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="border-white/[0.1] bg-white/[0.04] pl-8 text-white placeholder:text-[#555] focus:border-white/[0.2]"
                />
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="newPassword" className="text-[#888]">
                New password
                <span className="ml-2 text-xs text-[#555]">(10+ characters)</span>
              </FieldLabel>
              <div className="relative">
                <IconLock className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#555]" />
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  className="border-white/[0.1] bg-white/[0.04] pl-8 text-white placeholder:text-[#555] focus:border-white/[0.2]"
                />
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirmPassword" className="text-[#888]">
                Confirm new password
              </FieldLabel>
              <div className="relative">
                <IconLock className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#555]" />
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  className="border-white/[0.1] bg-white/[0.04] pl-8 text-white placeholder:text-[#555] focus:border-white/[0.2]"
                />
              </div>
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>

          <Button
            type="submit"
            className="mt-4 w-full border border-white/[0.1] bg-white/[0.04] text-[#999] hover:bg-white/[0.08] hover:text-white h-11 text-sm font-medium"
            disabled={loading}
          >
            <IconLock data-icon="inline-start" />
            {loading ? "Saving..." : "Set new password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
