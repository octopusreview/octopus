import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { IconCheck } from "@tabler/icons-react";
import { Cell, type ComparisonRow } from "../compare/_shared";

export const metadata: Metadata = {
  title: "Octopus vs CodeRabbit — AI Code Review Comparison",
  description:
    "Compare Octopus and CodeRabbit for AI code review. Pricing, self-hosting, BYO API keys, language support, and more — see which fits your team best.",
  keywords: [
    "Octopus vs CodeRabbit",
    "CodeRabbit alternative",
    "AI code review comparison",
    "open source code review",
    "self-hosted code review",
  ],
  openGraph: {
    title: "Octopus vs CodeRabbit — AI Code Review Comparison",
    description:
      "Compare Octopus and CodeRabbit for AI code review. Pricing, self-hosting, BYO API keys, language support, and more.",
    url: "https://octopus-review.ai/vs-coderabbit",
    type: "website",
  },
  alternates: {
    canonical: "https://octopus-review.ai/vs-coderabbit",
  },
};

const faqs = [
  {
    q: "Can I try both Octopus and CodeRabbit on the same repository?",
    a: "Yes. Both tools install as a GitHub or Bitbucket app and configure independently. Running them side by side for a few pull requests is a common way to see which review style fits your team better.",
  },
  {
    q: "Does Octopus support GitLab?",
    a: "Yes. Octopus supports GitHub, Bitbucket, and GitLab (gitlab.com and self-hosted) — connect a group or user namespace via OAuth and MRs get the same auto-review treatment as GitHub PRs.",
  },
  {
    q: "What are the main differences in approach?",
    a: "Under the hood, Octopus uses RAG: it pre-indexes your codebase into vector embeddings and retrieves the most relevant chunks during review. CodeRabbit uses Dynamic Discovery, fetching context on demand while it reviews the diff. Both are valid strategies with different tradeoffs: RAG is consistent and fast at review time; Dynamic Discovery avoids index maintenance. Beyond the technical approach, Octopus is open source with self-hosting and usage-based pricing, while CodeRabbit is a managed SaaS with per-developer pricing.",
  },
  {
    q: "How does pricing work with Octopus?",
    a: "Octopus is credit-based and usage-only, so you pay for what the AI actually reviews. You can also bring your own Claude or OpenAI API key and pay the LLM provider directly. Self-hosted Octopus is free. See the pricing page for current rates.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: f.a,
    },
  })),
};

const rows: ComparisonRow[] = [
  { label: "GitHub support", octopus: true, competitor: true },
  { label: "Bitbucket support", octopus: true, competitor: true },
  { label: "GitLab support", octopus: true, competitor: true },
  { label: "Primary product focus", octopus: "Automated PR review + codebase chat", competitor: "Automated PR review" },
  { label: "Codebase context approach", octopus: "RAG (pre-indexed embeddings + vector search)", competitor: "Dynamic Discovery (on-demand context lookup)" },
  { label: "Language coverage", octopus: "Language-agnostic (LLM-based)", competitor: "Language-agnostic (LLM-based)" },
  { label: "Standalone codebase chat / Q&A", octopus: true, competitor: false },
  { label: "Codebase Q&A API for developers", octopus: true, competitor: false },
  { label: "Inline PR comments", octopus: true, competitor: true },
  { label: "Severity-rated findings", octopus: "Critical, Major, Minor, Suggestion, Tip", competitor: "Review comments" },
  { label: "Open source", octopus: "MIT licensed", competitor: "Proprietary SaaS" },
  { label: "Self-hosting option", octopus: true, competitor: false },
  { label: "Bring your own LLM API keys", octopus: true, competitor: "Enterprise plans" },
  { label: "Pricing model", octopus: "Usage-based credits", competitor: "Per-developer subscription" },
  { label: "Free tier", octopus: "Free credits + free self-host", competitor: "Free for open source repos" },
];

export default async function VsCodeRabbitPage() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);

  return (
    <div className="dark relative min-h-screen bg-[#0c0c0c] text-[#a0a0a0] selection:bg-white/20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <LandingMobileNav isLoggedIn={!!session} />
      <LandingDesktopNav isLoggedIn={!!session} />

      <section className="relative z-10 px-6 pt-32 pb-16 md:px-8 md:pt-40 md:pb-20">
        <div className="mx-auto max-w-4xl text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
            Comparison
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            Octopus <span className="text-[#555]">vs</span>{" "}
            <span className="bg-gradient-to-r from-[#FFD4A8] via-[#FF8A3D] to-[#F15A24] bg-clip-text text-transparent">
              CodeRabbit
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-[#888]">
            Both Octopus and CodeRabbit are solid AI code review tools. They
            take different approaches to delivery, pricing, and deployment.
            This page lays out the differences so you can pick what fits your
            team.
          </p>
        </div>
      </section>

      <section className="relative z-10 px-4 pb-16 sm:px-8 md:px-12">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616]">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="px-6 py-5 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
                    Feature
                  </th>
                  <th className="px-6 py-5 text-sm font-semibold text-white">
                    Octopus
                  </th>
                  <th className="px-6 py-5 text-sm font-semibold text-[#cfcfcf]">
                    CodeRabbit
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.label}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="px-6 py-4 text-sm text-[#cfcfcf]">
                      {row.label}
                    </td>
                    <td className="px-6 py-4">
                      <Cell value={row.octopus} />
                    </td>
                    <td className="px-6 py-4">
                      <Cell value={row.competitor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="relative z-10 px-4 pb-16 sm:px-8 md:px-12">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.06] bg-[#161616] p-8">
            <h2 className="text-xl font-bold tracking-tight text-white">
              When to choose Octopus
            </h2>
            <ul className="mt-5 space-y-3 text-sm text-[#a0a0a0]">
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                You want to self-host on your own infrastructure.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                You prefer credit-based, usage-only pricing over per-seat fees.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                You want to bring your own Claude or OpenAI API keys.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                Open source matters for audit, compliance, or customization.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                You want a CLI to run reviews from the terminal too.
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-[#161616] p-8">
            <h2 className="text-xl font-bold tracking-tight text-white">
              When CodeRabbit is a great fit
            </h2>
            <ul className="mt-5 space-y-3 text-sm text-[#a0a0a0]">
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#cfcfcf]" />
                You prefer a fully managed SaaS so your team can stay focused
                on product work.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#cfcfcf]" />
                Predictable per-developer pricing is a better fit for your
                budgeting process.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="relative z-10 px-4 pb-20 sm:px-8 md:px-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-8 space-y-4">
            {faqs.map((f) => (
              <div
                key={f.q}
                className="rounded-2xl border border-white/[0.06] bg-[#161616] p-6"
              >
                <h3 className="text-base font-semibold text-white">{f.q}</h3>
                <p className="mt-3 text-sm text-[#a0a0a0]">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 px-6 pb-24 md:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Try Octopus free on your next PR
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[#888]">
            Free credits to start, open source, and self-hostable. No credit
            card required.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href={session ? "/dashboard" : "/login"}
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition-all hover:bg-[#e0e0e0]"
            >
              {session ? "Go to Dashboard" : "Start free"}
            </Link>
            <Link
              href="/docs/pricing"
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-8 py-3 text-sm font-medium text-[#999] transition-all hover:border-white/[0.2] hover:text-white"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
