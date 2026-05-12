"use client";

import * as React from "react";
import { Suspense, lazy } from "react";
import Image from "next/image";
import Link from "@/components/link";
import { useSearchParams } from "next/navigation";
import { signIn, magicLinkSignIn } from "@/lib/auth-client";
import { normalizeEmail } from "@/lib/email-normalize";
import { trackEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { IconMail, IconBrandGithub } from "@tabler/icons-react";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

const LoginOctopus = lazy(() =>
  import("@/components/login-octopus").then((m) => ({ default: m.LoginOctopus }))
);

function LoginContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  React.useEffect(() => {
    trackEvent("login_page_view");
  }, []);

  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [email, setEmail] = React.useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const rawEmail = formData.get("email") as string;
    const emailValue = normalizeEmail(rawEmail);

    trackEvent("login_method_click", { method: "magic_link" });

    const { error } = await magicLinkSignIn({ email: emailValue, callbackURL: callbackUrl });

    if (error) {
      trackEvent("login_magic_link_error", { error: error.message ?? "unknown" });
      setError(error.message ?? "Failed to send magic link");
      setLoading(false);
    } else {
      trackEvent("login_magic_link_sent");
      setEmail(emailValue);
      setSent(true);
      setLoading(false);
    }
  }

  const formContent = sent ? (
    <div className="w-full max-w-sm">
      <h2 className="text-2xl font-bold text-white">Check your email</h2>
      <p className="mt-2 text-sm text-[#888]">
        We sent a sign-in link to <strong className="text-white">{email}</strong>
      </p>
      <p className="mt-4 text-sm text-[#666]">
        Click the link in your email to sign in. If you don&apos;t see it,
        check your spam folder.
      </p>
      <button
        className="mt-6 w-full rounded-lg border border-white/[0.1] px-4 py-2.5 text-sm font-medium text-[#999] transition-colors hover:border-white/[0.2] hover:text-white"
        onClick={() => {
          trackEvent("login_try_different_email");
          setSent(false);
          setEmail("");
        }}
      >
        Try a different email
      </button>
    </div>
  ) : (
    <div className="w-full max-w-sm">
      <h2 className="text-2xl font-bold tracking-tight text-white">
        Sign in to Octopus
      </h2>
      <p className="mt-2 text-sm text-[#666]">
        Choose your preferred sign-in method
      </p>

      {/* Social buttons */}
      <div className="mt-8 flex flex-col gap-3">
        <Button
          type="button"
          className="w-full bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/[0.1] h-11 text-sm font-medium"
          onClick={() => {
            trackEvent("login_method_click", { method: "google" });
            signIn.social({ provider: "google", callbackURL: callbackUrl });
          }}
        >
          <GoogleIcon className="size-5 shrink-0" />
          Sign in with Google
        </Button>
        <Button
          type="button"
          className="w-full bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/[0.1] h-11 text-sm font-medium"
          onClick={() => {
            trackEvent("login_method_click", { method: "github" });
            signIn.social({ provider: "github", callbackURL: callbackUrl });
          }}
        >
          <IconBrandGithub data-icon="inline-start" className="size-5" />
          Sign in with GitHub
        </Button>
      </div>

      <div className="my-6">
        <FieldSeparator className="text-[#555]">or continue with email</FieldSeparator>
      </div>

      {/* Magic link form */}
      <form id="login-form" onSubmit={handleSubmit}>
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
                className="border-white/[0.1] bg-white/[0.04] pl-8 text-white placeholder:text-[#555] focus:border-white/[0.2]"
              />
            </div>
          </Field>
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
      </form>

      <Button
        type="submit"
        form="login-form"
        className="mt-4 w-full border border-white/[0.1] bg-white/[0.04] text-[#999] hover:bg-white/[0.08] hover:text-white h-11 text-sm font-medium"
        disabled={loading}
      >
        <IconMail data-icon="inline-start" />
        {loading ? "Sending..." : "Send magic link"}
      </Button>
    </div>
  );

  return (
    <div className="dark flex min-h-screen bg-[#0c0c0c] text-[#a0a0a0]">
      {/* Grain overlay — same as landing */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.025]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Left side — form */}
      <div className="relative z-10 flex w-full flex-col items-center justify-center p-8 lg:w-1/2">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <Link
            href="/"
            className="mb-10 flex items-center gap-3 transition-opacity hover:opacity-80"
            onClick={() => trackEvent("login_logo_click", { location: "login" })}
          >
            <Image
              src="/logo.svg"
              alt="Octopus"
              width={36}
              height={38}
              priority
            />
            <span className="text-xl font-bold tracking-tight text-white">Octopus</span>
          </Link>

          {formContent}
        </div>
      </div>

      {/* Right side — octopus (hidden on mobile) */}
      <div className="relative hidden lg:flex lg:w-1/2 items-center justify-center overflow-hidden border-l border-white/[0.06]">
        {/* Subtle radial glow behind octopus */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f1a18] via-[#0c0c0c] to-[#0c0c0c]" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-[500px] rounded-full bg-[#10d8be]/[0.04] blur-[100px]" />

        <div className="absolute inset-0">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Image
                  src="/logo.svg"
                  alt="Octopus"
                  width={80}
                  height={84}
                  className="animate-pulse opacity-20"
                />
              </div>
            }
          >
            <LoginOctopus />
          </Suspense>
        </div>

        {/* Tagline overlay */}
        <div className="relative z-10 mt-[60%] text-center px-12 pointer-events-none">
          <p className="text-sm text-[#555]">
            AI-powered code reviews that never sleep
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
