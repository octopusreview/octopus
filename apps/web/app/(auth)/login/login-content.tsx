"use client";

import * as React from "react";
import Image from "next/image";
import Link from "@/components/link";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn, signUp, magicLinkSignIn } from "@/lib/auth-client";
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
import {
  IconMail,
  IconBrandGithub,
  IconLock,
  IconBolt,
  IconShieldLock,
  IconGitPullRequest,
  IconSparkles,
  IconArrowRight,
} from "@tabler/icons-react";

/** Which OAuth providers the deployment has configured. Computed server-side
 * (see ./page.tsx) so the buttons render correctly on first paint. */
export type SocialEnabled = {
  google: boolean;
  github: boolean;
  microsoft: boolean;
};

// magic-link (default) | password sign-in | sign-up. The password modes only
// render when the server reports password auth is enabled (self-hosted).
type AuthMode = "magic-link" | "password" | "signup";

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

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M2 2h9.5v9.5H2z" fill="#F25022" />
      <path d="M12.5 2H22v9.5h-9.5z" fill="#7FBA00" />
      <path d="M2 12.5h9.5V22H2z" fill="#00A4EF" />
      <path d="M12.5 12.5H22V22h-9.5z" fill="#FFB900" />
    </svg>
  );
}

const LOGIN_FEATURES = [
  {
    icon: IconGitPullRequest,
    title: "Reviews on every pull request",
    description:
      "Inline, source-backed comments on GitHub, GitLab and Bitbucket — minutes after every push.",
  },
  {
    icon: IconShieldLock,
    title: "Catches issues before they merge",
    description:
      "Bugs, security holes and anti-patterns flagged with severity, so they never reach production.",
  },
  {
    icon: IconSparkles,
    title: "Learns your codebase",
    description:
      "Repository-wide indexing grounds every finding in your actual code and team standards — not just the diff.",
  },
  {
    icon: IconBolt,
    title: "Free credits to start",
    description:
      "Sign in and get reviewing in two minutes. No credit card, nothing to install or run.",
  },
] as const;

export function LoginContent({
  socialEnabled,
  passwordAuth,
}: {
  socialEnabled: SocialEnabled;
  passwordAuth: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  React.useEffect(() => {
    trackEvent("login_page_view");
  }, []);

  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [authMode, setAuthMode] = React.useState<AuthMode>("magic-link");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const rawEmail = formData.get("email") as string;
    const emailValue = normalizeEmail(rawEmail);
    const password = (formData.get("password") as string) || "";
    const name = (formData.get("name") as string) || "";

    // Password sign-in / sign-up — self-hosted only. When password auth is
    // off (SaaS) authMode stays "magic-link" and we fall straight through.
    if (passwordAuth && authMode === "password") {
      trackEvent("login_method_click", { method: "password" });
      const { error } = await signIn.email({ email: emailValue, password, callbackURL: callbackUrl });
      if (error) {
        setError(error.message ?? "Invalid email or password");
        setLoading(false);
        return;
      }
      router.push(callbackUrl);
      return;
    }

    if (passwordAuth && authMode === "signup") {
      trackEvent("login_method_click", { method: "signup" });
      const { error } = await signUp.email({
        email: emailValue,
        password,
        name: name || emailValue.split("@")[0],
        callbackURL: callbackUrl,
      });
      if (error) {
        setError(error.message ?? "Could not create account");
        setLoading(false);
        return;
      }
      // autoSignIn=true in auth.ts means the session already exists.
      router.push(callbackUrl);
      return;
    }

    // magic-link (default)
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
          disabled={!socialEnabled.google}
          title={!socialEnabled.google ? "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable" : undefined}
          className="w-full bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/[0.1] h-11 text-sm font-medium"
          onClick={() => {
            trackEvent("login_method_click", { method: "google" });
            signIn.social({ provider: "google", callbackURL: callbackUrl });
          }}
        >
          <GoogleIcon className="size-5 shrink-0" />
          Sign in with Google{!socialEnabled.google ? " (not configured)" : ""}
        </Button>
        <Button
          type="button"
          disabled={!socialEnabled.github}
          title={!socialEnabled.github ? "Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to enable" : undefined}
          className="w-full bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/[0.1] h-11 text-sm font-medium"
          onClick={() => {
            trackEvent("login_method_click", { method: "github" });
            signIn.social({ provider: "github", callbackURL: callbackUrl });
          }}
        >
          <IconBrandGithub data-icon="inline-start" className="size-5" />
          Sign in with GitHub{!socialEnabled.github ? " (not configured)" : ""}
        </Button>
        <Button
          type="button"
          disabled={!socialEnabled.microsoft}
          title={!socialEnabled.microsoft ? "Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to enable" : undefined}
          className="w-full bg-white/[0.06] hover:bg-white/[0.12] text-white border border-white/[0.1] h-11 text-sm font-medium"
          onClick={() => {
            trackEvent("login_method_click", { method: "microsoft" });
            signIn.social({ provider: "microsoft", callbackURL: callbackUrl });
          }}
        >
          <MicrosoftIcon className="size-5 shrink-0" />
          Sign in with Microsoft{!socialEnabled.microsoft ? " (not configured)" : ""}
        </Button>
      </div>

      {!socialEnabled.google &&
        !socialEnabled.github &&
        !socialEnabled.microsoft && (
        <p className="mt-3 text-center text-xs text-[#555]">
          No OAuth providers configured. Self-hosting? See{" "}
          <Link href="/docs/oauth-setup" className="text-cyan-400 underline">
            OAuth setup
          </Link>{" "}
          — or use the magic-link option below.
        </p>
      )}

      <div className="my-6">
        <FieldSeparator className="text-[#555]">or continue with email</FieldSeparator>
      </div>

      {/* Email form — magic-link by default; password / signup when enabled */}
      <form id="login-form" onSubmit={handleSubmit}>
        <FieldGroup>
          {passwordAuth && authMode === "signup" && (
            <Field>
              <FieldLabel htmlFor="name" className="text-[#888]">Name</FieldLabel>
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="Ada Lovelace"
                autoComplete="name"
                className="border-white/[0.1] bg-white/[0.04] text-white placeholder:text-[#555] focus:border-white/[0.2]"
              />
            </Field>
          )}
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
          {passwordAuth && (authMode === "password" || authMode === "signup") && (
            <Field>
              <FieldLabel htmlFor="password" className="text-[#888]">
                Password
                {authMode === "signup" && (
                  <span className="ml-2 text-xs text-[#555]">(10+ characters)</span>
                )}
              </FieldLabel>
              <div className="relative">
                <IconLock className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#555]" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={authMode === "signup" ? 10 : undefined}
                  autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                  className="border-white/[0.1] bg-white/[0.04] pl-8 text-white placeholder:text-[#555] focus:border-white/[0.2]"
                />
              </div>
            </Field>
          )}
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
      </form>

      <Button
        type="submit"
        form="login-form"
        className="mt-4 w-full border border-white/[0.1] bg-white/[0.04] text-[#999] hover:bg-white/[0.08] hover:text-white h-11 text-sm font-medium"
        disabled={loading}
      >
        {authMode === "magic-link" ? (
          <IconMail data-icon="inline-start" />
        ) : (
          <IconLock data-icon="inline-start" />
        )}
        {loading
          ? authMode === "magic-link"
            ? "Sending..."
            : "Working…"
          : authMode === "magic-link"
            ? "Send magic link"
            : authMode === "password"
              ? "Sign in"
              : "Create account"}
      </Button>

      {passwordAuth && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[#666]">
          {authMode !== "magic-link" && (
            <button
              type="button"
              className="hover:text-white"
              onClick={() => { setError(null); setAuthMode("magic-link"); }}
            >
              Use a magic link
            </button>
          )}
          {authMode !== "password" && (
            <button
              type="button"
              className="hover:text-white"
              onClick={() => { setError(null); setAuthMode("password"); }}
            >
              Sign in with a password
            </button>
          )}
          {authMode !== "signup" && (
            <button
              type="button"
              className="hover:text-white"
              onClick={() => { setError(null); setAuthMode("signup"); }}
            >
              Create an account
            </button>
          )}
          {authMode === "password" && (
            <Link href="/forgot-password" className="hover:text-white">
              Forgot password?
            </Link>
          )}
        </div>
      )}
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

      {/* Right side — product highlights (hidden on mobile) */}
      <div className="relative hidden lg:flex lg:w-1/2 items-center justify-center overflow-hidden border-l border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f1a18] via-[#0c0c0c] to-[#0c0c0c]" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-[500px] rounded-full bg-[#10d8be]/[0.04] blur-[100px]" />

        <div className="relative z-10 w-full max-w-md px-12">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#10d8be]/70">
            Your AI senior reviewer
          </p>
          <h2 className="mt-3 text-2xl font-semibold leading-snug text-white">
            Every pull request, reviewed in minutes.
          </h2>

          <ul className="mt-10 space-y-7">
            {LOGIN_FEATURES.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                  <Icon className="size-[18px] text-[#10d8be]" stroke={1.75} />
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[#888]">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-10 text-xs leading-relaxed text-[#555]">
            Your code is never stored long-term or used to train models.
          </p>
          <a
            href="/docs/self-hosting"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-[#10d8be]/70 transition-colors hover:text-[#10d8be]"
          >
            Prefer to run it yourself? Self-host Octopus
            <IconArrowRight className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
