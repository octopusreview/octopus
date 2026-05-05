import type { Metadata } from "next";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { TrackedAnchor } from "@/components/tracked-link";
import { FaqList } from "@/components/FaqList";
import { ObfuscatedEmail } from "@/components/obfuscated-email";
import {
  IconShieldCheck,
  IconGift,
  IconStar,
  IconCoin,
  IconCash,
  IconCircleCheck,
  IconCircleX,
  IconTrophy,
  IconMail,
  IconBrandGithub,
} from "@tabler/icons-react";

export const metadata: Metadata = {
  title: "Bug Bounty Program — Octopus",
  description:
    "Help make Octopus more secure. Report vulnerabilities and earn rewards including swag, credits, and cash bounties for critical findings.",
  alternates: {
    canonical: "https://octopus-review.ai/bug-bounty",
  },
};

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const rewardTiers = [
  {
    icon: IconCash,
    title: "Cash Bounties",
    description:
      "Up to $2,000 for critical vulnerabilities like RCE, auth bypass, or data leaks.",
  },
  {
    icon: IconGift,
    title: "Swag Pack",
    description:
      "Exclusive Octopus stickers, t-shirts, and limited-edition merch for valid reports.",
  },
  {
    icon: IconCoin,
    title: "Octopus Credits",
    description:
      "Free usage credits on Octopus so you can review more PRs on us.",
  },
  {
    icon: IconStar,
    title: "Recognition",
    description:
      "Your name in our Hall of Fame, README, and a contributor badge on your profile.",
  },
];

const severityLevels = [
  {
    level: "Critical",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    examples: "RCE, authentication bypass, mass data exposure, SQL injection",
    reward: "$500 - $2,000 + swag + credits",
  },
  {
    level: "High",
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/20",
    examples: "Stored XSS, IDOR, privilege escalation, API key leakage",
    reward: "$100 - $500 + swag + credits",
  },
  {
    level: "Medium",
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/20",
    examples: "CSRF, reflected XSS, information disclosure, open redirect",
    reward: "Swag + credits + recognition",
  },
  {
    level: "Low",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    examples:
      "Minor misconfiguration, missing security headers, best practice violations",
    reward: "Recognition + sticker pack",
  },
];

const inScope = [
  "octopus-review.ai web application",
  "Public API endpoints",
  "GitHub & Bitbucket integration flows",
  "Authentication & authorization flows",
  "Octopus CLI tool",
  "Webhook processing pipeline",
];

const outOfScope = [
  "Denial of service (DoS/DDoS) attacks",
  "Social engineering or phishing",
  "Third-party services (Stripe, GitHub, etc.)",
  "Spam or rate limiting without security impact",
  "Issues in dependencies without a working exploit",
  "Attacks requiring physical access",
];

const rules = [
  "Give us 90 days to fix the issue before any public disclosure.",
  "Only test against accounts you own. Do not access other users' data.",
  "Do not use automated mass scanning tools that degrade service for others.",
  "Submit reports through the designated channels listed below.",
  "One vulnerability per report. Chaining is fine, but describe each step.",
  "Do not publicly disclose the vulnerability before we confirm the fix.",
  "Write your report in English with clear reproduction steps.",
];

const faqs = [
  {
    q: "Who is eligible to participate?",
    a: "Anyone can participate as long as they follow the rules of engagement. You do not need to be an existing Octopus user. Employees and contractors of Octopus are not eligible.",
  },
  {
    q: "What happens if someone else reports the same vulnerability?",
    a: "We reward the first valid report. If you submit a duplicate, we will let you know and credit will go to the original reporter.",
  },
  {
    q: "How quickly will I hear back?",
    a: "We aim to acknowledge your report within 3 business days and provide an initial assessment within 10 business days.",
  },
  {
    q: "Can I disclose publicly after the fix?",
    a: "Yes. Once we confirm the vulnerability is fixed, you are free to publish a write-up. We encourage responsible disclosure and will credit you in our release notes.",
  },
  {
    q: "What if a vulnerability spans multiple severity levels?",
    a: "We assess based on the maximum realistic impact. If you demonstrate a chain that escalates impact, we reward the highest severity in the chain.",
  },
  {
    q: "Am I legally protected?",
    a: "Yes. As long as you follow the rules of engagement, we will not pursue legal action. We consider security research conducted under this program as authorized.",
  },
];

// Hall of fame entries - add new entries here as researchers report valid bugs
const hallOfFame: {
  name: string;
  github?: string;
  finding: string;
  date: string;
}[] = [];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function BugBountyPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  return (
    <div className="dark relative min-h-screen bg-[#0c0c0c] text-[#a0a0a0] selection:bg-white/20">
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
            <IconShieldCheck className="size-4" />
            Security Program
          </div>
          <h1 className="animate-fade-in text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            Bug Bounty Program
          </h1>
          <p className="animate-fade-in mt-4 max-w-2xl mx-auto text-lg text-[#666] [animation-delay:100ms]">
            Help us keep Octopus secure for everyone. Find vulnerabilities, report
            them responsibly, and earn rewards.
          </p>
          <div className="animate-fade-in mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row [animation-delay:200ms]">
            <a
              href="#submit"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-[#0c0c0c] transition-colors hover:bg-[#e0e0e0]"
            >
              Submit a Report
            </a>
            <a
              href="#scope"
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-6 py-3 text-sm font-medium text-[#ccc] transition-colors hover:border-white/[0.2] hover:text-white"
            >
              View Scope
            </a>
          </div>
        </div>
      </section>

      {/* Reward Tiers */}
      <Section>
        <SectionHeader
          label="Rewards"
          title="What you can earn"
          description="We reward security researchers based on the severity and impact of their findings."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {rewardTiers.map((tier) => (
            <div
              key={tier.title}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition-colors hover:border-white/[0.12]"
            >
              <tier.icon className="size-6 text-teal-400" />
              <h3 className="mt-3 text-base font-semibold text-white">
                {tier.title}
              </h3>
              <p className="mt-2 text-sm text-[#888]">{tier.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Severity & Rewards */}
      <Section>
        <SectionHeader
          label="Severity"
          title="Severity levels & rewards"
          description="Rewards scale with the impact of the vulnerability. Here is how we classify findings."
        />
        <div className="mt-10 space-y-3">
          {severityLevels.map((s) => (
            <div
              key={s.level}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 md:p-6"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex-1">
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${s.bg} ${s.color}`}
                  >
                    {s.level}
                  </span>
                  <p className="mt-3 text-sm text-[#888]">{s.examples}</p>
                </div>
                <div className="md:text-right">
                  <p className="text-sm font-medium text-white">{s.reward}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Scope */}
      <Section id="scope">
        <SectionHeader
          label="Scope"
          title="What is in scope"
          description="Only test within the defined scope. Out-of-scope submissions will not be eligible for rewards."
        />
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] p-6">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
              In Scope
            </span>
            <ul className="mt-4 space-y-3">
              {inScope.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-[#888]">
                  <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-400/60" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-white/[0.06] p-6">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-red-400">
              Out of Scope
            </span>
            <ul className="mt-4 space-y-3">
              {outOfScope.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-[#888]">
                  <IconCircleX className="mt-0.5 size-4 shrink-0 text-red-400/60" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* Rules of Engagement */}
      <Section>
        <SectionHeader
          label="Rules"
          title="Rules of engagement"
          description="Follow these guidelines to ensure your research is authorized and eligible for rewards."
        />
        <div className="mt-10 space-y-4">
          {rules.map((rule, i) => (
            <div key={i} className="flex items-start gap-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-xs font-bold text-teal-400">
                {i + 1}
              </span>
              <p className="pt-0.5 text-sm text-[#888]">{rule}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Hall of Fame */}
      <Section>
        <SectionHeader
          label="Recognition"
          title="Hall of Fame"
          description="Security researchers who helped make Octopus safer."
        />
        <div className="mt-10">
          {hallOfFame.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-16 text-center">
              <IconTrophy className="size-10 text-[#333]" />
              <p className="mt-4 text-sm text-[#555]">
                Be the first to earn a spot here.
              </p>
              <a
                href="#submit"
                className="mt-4 text-sm text-teal-400 transition-colors hover:text-teal-300"
              >
                Submit a report
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {hallOfFame.map((entry) => (
                <div
                  key={entry.name + entry.date}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4"
                >
                  <div className="flex items-center gap-3">
                    <IconTrophy className="size-5 text-yellow-500" />
                    <div>
                      <p className="text-sm font-medium text-white">
                        {entry.github ? (
                          <a
                            href={`https://github.com/${entry.github}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-teal-400 transition-colors"
                          >
                            {entry.name}
                          </a>
                        ) : (
                          entry.name
                        )}
                      </p>
                      <p className="text-xs text-[#888]">{entry.finding}</p>
                    </div>
                  </div>
                  <span className="text-xs text-[#555]">{entry.date}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* Submit a Report */}
      <section id="submit" className="relative z-10 px-4 py-4 sm:px-8 md:px-12">
        <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-16 md:px-12 md:py-20">
          <SectionHeader
            label="Report"
            title="Submit a vulnerability"
            description="Choose the channel that works best for you. Include clear reproduction steps and the expected vs. actual behavior."
          />
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <ObfuscatedEmail
              user="security"
              showIcon={false}
              className="group flex cursor-pointer items-start gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition-colors hover:border-white/[0.12]"
              as="div"
            >
              <IconMail className="mt-0.5 size-6 shrink-0 text-teal-400" />
              <div>
                <p className="text-base font-semibold text-white">Email</p>
                <p className="mt-1 text-sm text-[#888]">
                  <ObfuscatedEmail user="security" showIcon={false} className="text-sm text-[#888]" />
                </p>
                <p className="mt-2 text-xs text-[#555]">
                  Best for detailed reports with attachments.
                </p>
              </div>
            </ObfuscatedEmail>
            <TrackedAnchor
              href="https://github.com/octopusreview/octopus/security/advisories/new"
              target="_blank"
              rel="noopener noreferrer"
              event="bug_bounty_submit"
              eventParams={{ channel: "github" }}
              className="group flex items-start gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition-colors hover:border-white/[0.12]"
            >
              <IconBrandGithub className="mt-0.5 size-6 shrink-0 text-teal-400" />
              <div>
                <p className="text-base font-semibold text-white">
                  GitHub Security Advisory
                </p>
                <p className="mt-1 text-sm text-[#888]">
                  Private vulnerability report on GitHub.
                </p>
                <p className="mt-2 text-xs text-[#555]">
                  Best if you already have a GitHub account.
                </p>
              </div>
            </TrackedAnchor>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <Section>
        <SectionHeader
          label="FAQ"
          title="Frequently asked questions"
        />
        <FaqList faqs={faqs} visibleCount={4} />
      </Section>

      {/* Disclaimer */}
      <section className="relative z-10 px-6 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm text-[#444]">
            Octopus reserves the right to modify or cancel this program at any
            time. <br />Reward amounts are at our discretion based on impact and
            quality of the report.
          </p>
          <p className="mt-4 text-sm text-[#666]">
            For the full policy, scope details, and safe-harbor terms, see our{" "}
            <a
              href="/docs/security"
              className="text-teal-400 underline decoration-teal-400/30 underline-offset-2 transition-colors hover:text-teal-300 hover:decoration-teal-300"
            >
              Security Policy
            </a>
            .
          </p>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Section({
  children,
  id,
}: {
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="relative z-10 px-4 py-4 sm:px-8 md:px-12"
    >
      <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-16 md:px-12 md:py-20">
        {children}
      </div>
    </section>
  );
}

function SectionHeader({
  label,
  title,
  description,
}: {
  label: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
        {label}
      </span>
      <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        {title}
      </h2>
      {description && (
        <p className="mt-3 max-w-2xl text-[#888]">{description}</p>
      )}
    </div>
  );
}
