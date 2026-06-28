"use client";

import * as React from "react";
import Image from "next/image";
import Link from "@/components/link";
import { requestPasswordReset } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { IconMail, IconArrowLeft } from "@tabler/icons-react";

/**
 * Forgot-password flow. Calls Better Auth's `requestPasswordReset` which
 * generates a token, persists it, and invokes our `sendResetPassword`
 * callback in `auth.ts` to email the link. The same magic-link email
 * template renders the message — operators don't need a second SMTP
 * config.
 */
export default function ForgotPasswordPage() {
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = (formData.get("email") as string).trim();

    // Better Auth returns ok even when the email doesn't exist (don't leak
    // whether an account exists). Treat any thrown error as "try again."
    const { error: err } = await requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    if (err) {
      setError(err.message ?? "Couldn't send reset email. Try again.");
      setLoading(false);
      return;
    }
    setSent(true);
    setLoading(false);
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

        {sent ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Check your email
            </h1>
            <p className="mt-3 text-sm text-[#888]">
              If an account exists for the address you entered, we&apos;ve
              sent a password reset link. The link expires in 1 hour.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Reset your password
            </h1>
            <p className="mt-2 text-sm text-[#666]">
              Enter your email and we&apos;ll send you a link to set a new password.
            </p>

            <form onSubmit={handleSubmit} className="mt-6">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email" className="text-[#888]">Email</FieldLabel>
                  <div className="relative">
                    <IconMail className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#555]" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
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
                <IconMail data-icon="inline-start" />
                {loading ? "Sending..." : "Send reset link"}
              </Button>
            </form>
          </>
        )}

        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-1 text-xs text-[#666] hover:text-white"
        >
          <IconArrowLeft className="size-3" />
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
