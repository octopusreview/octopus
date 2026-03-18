import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { FloatingOctopus } from "@/components/landing-unicorn-section";
import { LandingFeatures } from "@/components/landing-features";
import { TrackedLink, TrackedAnchor } from "@/components/tracked-link";
import { LandingFooter } from "@/components/landing-footer";
import {
  IconBrandGithub,
  IconArrowRight,
  IconCode,
  IconShieldCheck,
  IconPlugConnected,
  IconRocket,
  IconBrain,
  IconSparkles,
  IconEye,
  IconBolt,
  IconClock,
} from "@tabler/icons-react";

export default async function LandingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  return (
    <div className="dark relative min-h-screen bg-[#0c0c0c] text-[#a0a0a0] selection:bg-white/20">
      {/* Floating particle octopus — follows scroll across entire page */}
      <FloatingOctopus />

      {/* Grain overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.025]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Mobile nav — simple bar */}
      <nav className="fixed left-0 right-0 top-0 z-40 border-b border-white/[0.06] bg-[#0c0c0c]/80 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Image src="/logo.svg" alt="Octopus" width={22} height={22} />
            <span className="text-sm font-semibold text-white">Octopus</span>
          </div>
          {session ? (
            <Link href="/dashboard" className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-[#0c0c0c]">
              Dashboard
            </Link>
          ) : (
            <TrackedLink href="/login" event="cta_click" eventParams={{ location: "mobile_nav", label: "get_started" }} className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-[#0c0c0c]">
              Get Started
            </TrackedLink>
          )}
        </div>
      </nav>

      {/* Desktop nav — floating pill */}
      <nav className="fixed left-1/2 top-4 z-40 hidden -translate-x-1/2 lg:block">
        <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 shadow-lg shadow-black/20 backdrop-blur-xl">
          <div className="flex items-center gap-2 px-2">
            <Image src="/logo.svg" alt="Octopus" width={24} height={24} />
            <span className="text-sm font-semibold tracking-tight text-white">Octopus</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-[#777]">
            <a href="#features" className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">Features</a>
            <a href="#how-it-works" className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">How It Works</a>
            <TrackedLink href="/docs/about" event="nav_click" eventParams={{ label: "docs" }} className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">Docs</TrackedLink>
            <a href="https://github.com/octopusreview" target="_blank" rel="noopener noreferrer" className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">GitHub</a>
          </div>
          <div className="ml-2">
            {session ? (
              <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-[#0c0c0c] transition-colors hover:bg-[#e0e0e0]">
                Dashboard
                <IconArrowRight className="size-3.5" />
              </Link>
            ) : (
              <TrackedLink href="/login" event="cta_click" eventParams={{ location: "desktop_nav", label: "get_started" }} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-[#0c0c0c] transition-colors hover:bg-[#e0e0e0]">
                Get Started
                <IconArrowRight className="size-3.5" />
              </TrackedLink>
            )}
          </div>
        </div>
      </nav>

      {/* Hero — dark bg */}
      <section className="relative z-10 px-6 pb-20 pt-28 md:px-8 md:pb-28 md:pt-40">
        <div className="mx-auto max-w-4xl text-center">
          <div className="animate-fade-in mb-8 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-sm text-[#666]">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/40" />
              <span className="relative inline-flex size-1.5 rounded-full bg-white/60" />
            </span>
            AI-powered code review automation
          </div>

          <h1 className="animate-fade-in text-4xl font-bold leading-[1.1] tracking-tight text-white [animation-delay:100ms] sm:text-5xl md:text-6xl lg:text-7xl">
            Your AI code reviewer
            <br />
            <span className="text-[#666]">
              that never sleeps
            </span>
          </h1>

          <p className="animate-fade-in mx-auto mt-6 max-w-xl text-base text-[#666] [animation-delay:200ms] sm:text-lg">
            Octopus reviews every pull request with deep context awareness.
            Catch bugs, enforce standards, and ship with confidence.
          </p>

          <div className="animate-fade-in mt-10 flex flex-col items-center gap-4 [animation-delay:300ms] sm:flex-row sm:justify-center">
            <TrackedLink
              href="/login"
              event="cta_click"
              eventParams={{ location: "hero", label: "get_started_free" }}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-[#0c0c0c] transition-colors hover:bg-[#e0e0e0]"
            >
              Get Started Free
              <IconArrowRight className="size-4" />
            </TrackedLink>
            <TrackedAnchor
              href="https://github.com/octopusreview"
              target="_blank"
              rel="noopener noreferrer"
              event="cta_click"
              eventParams={{ location: "hero", label: "view_on_github" }}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-6 py-3 text-sm font-medium text-[#999] transition-colors hover:text-white"
            >
              <IconBrandGithub className="size-4" />
              View on GitHub
            </TrackedAnchor>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="relative z-10 px-4 sm:px-8 md:px-12">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-20 md:px-12 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">How it works</span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Three steps to better reviews
              </h2>
              <p className="mt-4 text-[#888]">
                Connect your repos, and Octopus starts reviewing automatically.
              </p>
            </div>

            <div className="mt-16 grid gap-4 lg:grid-cols-3">
              <StepCard
                step="01"
                icon={<IconPlugConnected className="size-5" />}
                title="Connect GitHub"
                description="Install the Octopus GitHub App and select repositories to monitor."
              />
              <StepCard
                step="02"
                icon={<IconBrain className="size-5" />}
                title="AI Learns Your Code"
                description="Octopus indexes your codebase, understands patterns and architecture."
              />
              <StepCard
                step="03"
                icon={<IconRocket className="size-5" />}
                title="Reviews on Autopilot"
                description="Every new PR gets an instant, context-aware review automatically."
              />
            </div>

            {/* Stats */}
            <div className="mt-16 grid grid-cols-2 gap-8 border-t border-white/[0.06] pt-12 lg:grid-cols-4">
              <StatItem icon={<IconBolt className="size-4" />} value="10x" label="Faster reviews" />
              <StatItem icon={<IconEye className="size-4" />} value="85%" label="Bugs caught" />
              <StatItem icon={<IconClock className="size-4" />} value="< 2 min" label="Review time" />
              <StatItem icon={<IconSparkles className="size-4" />} value="24/7" label="Always on" />
            </div>
          </div>
        </div>
      </section>

      {/* Features — DARK panel, split layout like skillo */}
      <section id="features" className="relative z-10 px-4 py-8 sm:px-8 md:px-12">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#161616] px-6 py-20 md:px-12 md:py-28">
          <LandingFeatures />
        </div>
      </section>

      {/* Open Source */}
      <section className="relative z-10 px-4 sm:px-8 md:px-12">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-20 md:px-12 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">Open Source</span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Fully open source,
                <br />
                built in the open
              </h2>
              <p className="mt-4 text-[#666] sm:text-lg">
                100% open source under the MIT license. Inspect the code,
                self-host on your own infrastructure, or contribute.
              </p>
            </div>

            <div className="mt-12 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/[0.06] p-6 text-center transition-colors hover:border-white/[0.12]">
                <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-white/[0.04] text-[#888]">
                  <IconCode className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold text-white">MIT Licensed</h3>
                <p className="mt-2 text-sm text-[#666]">
                  Use it however you want — personal, commercial, or enterprise.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] p-6 text-center transition-colors hover:border-white/[0.12]">
                <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-white/[0.04] text-[#888]">
                  <IconBrandGithub className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold text-white">Community Driven</h3>
                <p className="mt-2 text-sm text-[#666]">
                  PRs welcome. Report bugs, request features, or build integrations.
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] p-6 text-center transition-colors hover:border-white/[0.12]">
                <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-white/[0.04] text-[#888]">
                  <IconShieldCheck className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold text-white">Self-Host Ready</h3>
                <p className="mt-2 text-sm text-[#666]">
                  Deploy on your own servers. Your code never leaves your infrastructure.
                </p>
              </div>
            </div>

            <div className="mt-8 flex justify-center">
              <TrackedAnchor
                href="https://github.com/octopusreview"
                target="_blank"
                rel="noopener noreferrer"
                event="cta_click"
                eventParams={{ location: "open_source_section", label: "star_on_github" }}
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-6 py-3 text-sm font-medium text-[#999] transition-colors hover:text-white"
              >
                <IconBrandGithub className="size-4" />
                Star us on GitHub
              </TrackedAnchor>
            </div>
          </div>
        </div>
      </section>

      {/* CTA — dark bg (no panel, just full width) */}
      <section className="relative z-10 px-6 py-24 md:px-8 md:py-32">
        <div className="relative mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to transform your
            <br />
            code review workflow?
          </h2>
          <p className="mt-4 text-[#666] sm:text-lg">Open source, free forever. Set up in under 2 minutes.</p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <TrackedLink
              href="/login"
              event="cta_click"
              eventParams={{ location: "bottom_cta", label: "get_started_free" }}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-[#0c0c0c] transition-colors hover:bg-[#e0e0e0]"
            >
              Get Started — It&apos;s Free
              <IconArrowRight className="size-4" />
            </TrackedLink>
          </div>
          <p className="mt-6 text-xs text-[#444]">No credit card required. Self-host or use our cloud.</p>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function StatItem({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#888]">
        {icon}
      </div>
      <div className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{value}</div>
      <div className="mt-1 text-sm text-[#666]">{label}</div>
    </div>
  );
}

function StepCard({ step, icon, title, description }: { step: string; icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="group rounded-xl border border-white/[0.08] bg-white/[0.04] p-6 backdrop-blur-sm transition-colors hover:border-white/[0.15] hover:bg-white/[0.07]">
      <div className="flex items-center gap-4">
        <span className="text-3xl font-black text-white/[0.06]">{step}</span>
        <div className="flex size-10 items-center justify-center rounded-lg bg-white/[0.06] text-[#888] transition-colors group-hover:bg-white group-hover:text-[#0c0c0c]">
          {icon}
        </div>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[#888]">{description}</p>
    </div>
  );
}

