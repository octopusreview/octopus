"use client";

import * as React from "react";
import { Suspense } from "react";
import Image from "next/image";
import Link from "@/components/link";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { IconLock, IconArrowLeft } from "@tabler/icons-react";

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const newPassword = (formData.get("newPassword") as string) || "";
    const confirmPassword = (formData.get("confirmPassword") as string) || "";

    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      setLoading(false);
      return;
    }

    const { error: err } = await resetPassword({ newPassword, token });
    if (err) {
      setError(err.message ?? "Could not reset password. The link may have expired.");
      setLoading(false);
      return;
    }
    router.push("/login?reset=success");
  }

  if (!token) {
    return (
      <div className="text-sm text-red-300">
        Missing reset token. Open the link from your email, or{" "}
        <Link href="/forgot-password" className="text-cyan-400 underline">
          request a new reset email
        </Link>
        .
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup>
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
  );
}

export default function ResetPasswordPage() {
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

        <h1 className="text-2xl font-bold tracking-tight text-white">
          Set a new password
        </h1>
        <p className="mt-2 text-sm text-[#666]">
          You&apos;ll sign in automatically once your new password is saved.
        </p>

        <div className="mt-6">
          <Suspense>
            <ResetPasswordContent />
          </Suspense>
        </div>

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
