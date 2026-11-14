import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { FaqList } from "@/components/FaqList";
import { Section, SectionHeader } from "@/components/landing-section";
import {
  IconBug,
  IconShieldCheck,
  IconMessageCircle,
  IconBolt,
  IconTerminal2,
  IconPlugConnected,
  IconArrowRight,
} from "@tabler/icons-react";

export const metadata: Metadata = {
  title: { absolute: "Octopus in your editor — code review for AI coding agents" },
  description:
    "Building with AI? Octopus reviews the code your AI writes for real bugs and security issues, from your coding agent, and explains what it finds in plain English.",
  alternates: {
    canonical: "https://octopus-review.ai/editor",
  },
};

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const benefits = [
  {
    icon: IconBug,
    title: "Finds real bugs",
    description:
      "Not style nitpicks. Octopus looks for actual problems: broken logic, missing checks, and the kind of thing that quietly breaks later.",
  },
  {
    icon: IconShieldCheck,
    title: "Catches security holes",
    description:
      "Leaked secrets, unsafe database queries, doors an attacker could walk through. Octopus flags them before they ever go live.",
  },
  {
    icon: IconMessageCircle,
    title: "Explains it in plain English",
    description:
      "Every finding tells you what is wrong and how to fix it, in language you can actually follow. Ask a follow-up question any time.",
  },
  {
    icon: IconBolt,
    title: "No pull request needed",
    description:
      "Review what you are working on right now. Nothing to open on GitHub, no waiting on a teammate.",
  },
];

const steps = [
  {
    n: "1",
    title: "Choose your setup",
    description:
      "Use the Octopus CLI and a skill with your coding agent, or follow the separate Claude Code plugin guide.",
  },
  {
    n: "2",
    title: "Connect your account",
    description:
      "For the CLI, run octp login in your agent’s execution environment. For the Claude plugin, configure its organization API token. Check the connection before reviewing.",
  },
  {
    n: "3",
    title: "Just ask",
    description:
      "Choose the changes or pull request you want reviewed, then ask your agent to use Octopus and show the findings.",
  },
];

const exampleFindings = [
  {
    level: "Critical",
    color: "bg-red-500",
    text: "Passwords are saved without scrambling them. Anyone who sees the database could read them.",
  },
  {
    level: "Warning",
    color: "bg-orange-500",
    text: "This form does not check what the user typed, so it could receive unexpected data.",
  },
  {
    level: "Suggestion",
    color: "bg-yellow-500",
    text: "The same code is copied in three places. A shared helper would be easier to maintain.",
  },
];

const faqs = [
  {
    q: "Do I need to be a developer to use this?",
    a: "No. If you are building something with AI in Cursor or Claude Code, you can use Octopus. It reads the code for you and explains what it finds in plain language.",
  },
  {
    q: "Which editors does it work with?",
    a: "Claude Code, Codex, OpenCode, Hermes Agent, OpenClaw, and Cursor can use the Octopus CLI and shared skill through their terminal tools. Setup depends on where the agent runs.",
  },
  {
    q: "Is it free to try?",
    a: "Yes. New accounts come with free credits, and you can bring your own AI provider key to run reviews at no platform cost. See the pricing page for details.",
  },
  {
    q: "Does my code get sent anywhere?",
    a: "Selected diffs and review context are sent to your configured Octopus server and AI services. Reviews use Octopus credits or your provider budget. See the setup, security, and privacy guides for details.",
  },
  {
    q: "How is this different from the AI already in my editor?",
    a: "Your editor's AI writes code. Octopus checks it. It is a dedicated reviewer looking for bugs and security issues, with the context of your whole project and your past reviews.",
  },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function EditorPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  return (
    <div className="dark relative min-h-screen bg-background text-[#a0a0a0] selection:bg-white/20">
      {/* Grain overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.025]"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Navigation */}
      <LandingMobileNav isLoggedIn={!!session} />
      <LandingDesktopNav isLoggedIn={!!session} />

      {/* Hero */}
      <section className="relative z-10 px-6 pb-16 pt-28 md:px-8 md:pb-24 md:pt-40">
        <div className="mx-auto max-w-4xl text-center">
          <div className="animate-fade-in mb-6 inline-flex items-center gap-2 rounded-full border border-teal-500/20 bg-teal-500/10 px-4 py-1.5 text-sm text-teal-400">
            <IconPlugConnected className="size-4" />
            AI coding agents
          </div>
          <h1 className="animate-fade-in text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            Octopus, right inside your editor
          </h1>
          <p className="animate-fade-in mx-auto mt-4 max-w-2xl text-lg text-[#666] [animation-delay:100ms]">
            Building with an AI coding agent? Octopus reads the code
            your AI writes, finds the real bugs and security holes, and explains
            them in plain English, before any of it goes live.
          </p>
          <div className="animate-fade-in mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row [animation-delay:200ms]">
            <a
              href="#install"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-background transition-colors hover:bg-[#e0e0e0]"
            >
              Add it to your editor
            </a>
            <a
              href="#catches"
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-6 py-3 text-sm font-medium text-[#ccc] transition-colors hover:border-white/[0.2] hover:text-white"
            >
              See what it catches
            </a>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <Section>
        <SectionHeader
          label="Why it helps"
          title="A second set of eyes on everything you build"
          description="Your editor's AI is great at writing code fast. Octopus is the reviewer that checks it for the things that matter."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {benefits.map((b) => (
            <div
              key={b.title}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition-colors hover:border-white/[0.12]"
            >
              <b.icon className="size-6 text-teal-400" />
              <h3 className="mt-3 text-base font-semibold text-white">{b.title}</h3>
              <p className="mt-2 text-sm text-[#888]">{b.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section id="how">
        <SectionHeader label="How it works" title="Three steps, then just ask" />
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6"
            >
              <div className="flex size-9 items-center justify-center rounded-full border border-teal-500/20 bg-teal-500/10 text-sm font-semibold text-teal-400">
                {s.n}
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">{s.title}</h3>
              <p className="mt-2 text-sm text-[#888]">{s.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* What it catches */}
      <Section id="catches">
        <SectionHeader
          label="What it catches"
          title="Here is what a review looks like"
          description="You ask for a review and Octopus replies with clear, ranked findings. No jargon required."
        />
        <div className="mt-10 overflow-hidden rounded-xl border border-white/[0.08] bg-background">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3">
            <IconMessageCircle className="size-4 text-teal-400" />
            <span className="text-sm font-medium text-white">Octopus review</span>
            <span className="ml-auto font-mono text-xs text-[#555]">src/login.js</span>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {exampleFindings.map((f) => (
              <div key={f.level} className="flex items-start gap-3 px-5 py-4">
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${f.color}`}
                  aria-hidden="true"
                />
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#888]">
                    {f.level}
                  </span>
                  <p className="mt-0.5 text-sm text-[#ccc]">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Install */}
      <Section id="install">
        <SectionHeader
          label="Get started"
          title="Add Octopus to your editor"
          description="Choose the guide for your agent and check the connection before your first review."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex items-center gap-2">
              <IconTerminal2 className="size-5 text-teal-400" />
              <h3 className="text-base font-semibold text-white">CLI and skill setup</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[#aaa]">Step-by-step instructions for Claude Code, Codex, OpenCode, Hermes Agent, OpenClaw, and Cursor. Install the CLI where your agent runs, check your login, then add the shared skill.</p>
            <a href="/docs/cli/ai-agents" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-teal-300 underline underline-offset-4">Choose your coding agent <IconArrowRight aria-hidden="true" className="size-4" /></a>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex items-center gap-2">
              <IconPlugConnected className="size-5 text-teal-400" />
              <h3 className="text-base font-semibold text-white">Claude Code plugin</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[#aaa]">Read the current plugin setup, marketplace name, token configuration, and verification steps. Plugin installation and a working authenticated connection are separate checks.</p>
            <a href="/docs/cli/claude-code-integration" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-teal-300 underline underline-offset-4">Open the Claude Code guide <IconArrowRight aria-hidden="true" className="size-4" /></a>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-[#aaa]">A coding-agent subscription does not include Octopus reviews. New Octopus accounts receive free credits; reviews use those credits or your configured provider budget.</p>
      </Section>

      {/* FAQ */}
      <Section id="faq">
        <SectionHeader label="FAQ" title="Frequently asked questions" />
        <FaqList faqs={faqs} visibleCount={5} />
      </Section>

      {/* Final CTA */}
      <section className="relative z-10 px-6 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Catch the bugs before they ship
          </h2>
          <p className="mt-3 text-[#888]">
            Add Octopus to your editor and get a plain-English review of your
            code whenever you want one.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#install"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-background transition-colors hover:bg-[#e0e0e0]"
            >
              Add it to your editor
              <IconArrowRight className="size-3.5" />
            </a>
            <a
              href="/docs/getting-started"
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-6 py-3 text-sm font-medium text-[#ccc] transition-colors hover:border-white/[0.2] hover:text-white"
            >
              Read the docs
            </a>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
