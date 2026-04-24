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
  title: "Octopus vs Greptile — AI Code Review Comparison",
  description:
    "Compare Octopus and Greptile for AI code review and codebase intelligence. Architecture, pricing, self-hosting, and open source — see which fits your team.",
  keywords: [
    "Octopus vs Greptile",
    "Greptile alternative",
    "AI code review comparison",
    "open source code review",
    "RAG code review",
  ],
  openGraph: {
    title: "Octopus vs Greptile — AI Code Review Comparison",
    description:
      "Compare Octopus and Greptile for AI code review and codebase intelligence. Architecture, pricing, self-hosting, and open source.",
    url: "https://octopus-review.ai/vs-greptile",
    type: "website",
  },
  alternates: {
    canonical: "https://octopus-review.ai/vs-greptile",
  },
};

const faqs = [
  {
    q: "Can I try both Octopus and Greptile on the same repository?",
    a: "Yes. Both tools install via your Git provider and configure independently. Running them in parallel for a few pull requests is a common way to see which review style fits your team.",
  },
  {
    q: "Do Octopus and Greptile use the same technical approach?",
    a: "The foundation is similar: both use RAG (Retrieval Augmented Generation) with pre-indexed vector embeddings to give the LLM relevant codebase context during review and chat. Where they differ is positioning, deployment, and licensing rather than core architecture.",
  },
  {
    q: "Is Octopus open source?",
    a: "Yes. Octopus is MIT-licensed and free to self-host on your own infrastructure. Greptile is a proprietary SaaS. If audit, customization, or running fully on-prem matters for your team, Octopus is the only option of the two.",
  },
  {
    q: "Which is better for codebase chat or Q&A?",
    a: "Greptile started with codebase intelligence and Q&A as its flagship experience, and that focus shows in its API and chat product. Octopus offers chat too, but automated PR review with severity-rated findings is the primary product. Pick based on which use case you care about most.",
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
  { label: "GitLab support", octopus: "Planned", competitor: true },
  { label: "Primary product focus", octopus: "Automated PR review + codebase chat", competitor: "Codebase intelligence + PR review" },
  { label: "Codebase context approach", octopus: "RAG (pre-indexed embeddings + vector search)", competitor: "RAG (pre-indexed embeddings + vector search)" },
  { label: "Language coverage", octopus: "Language-agnostic (LLM-based)", competitor: "Language-agnostic (LLM-based)" },
  { label: "Standalone codebase chat / Q&A", octopus: true, competitor: true },
  { label: "Codebase Q&A API for developers", octopus: true, competitor: true },
  { label: "Inline PR comments", octopus: true, competitor: true },
  { label: "Severity-rated findings", octopus: "Critical, Major, Minor, Suggestion, Tip", competitor: "Review comments" },
  { label: "Open source", octopus: "MIT licensed", competitor: "Proprietary SaaS" },
  { label: "Self-hosting option", octopus: true, competitor: "Enterprise plans" },
  { label: "Bring your own LLM API keys", octopus: true, competitor: "Enterprise plans" },
  { label: "Pricing model", octopus: "Usage-based credits", competitor: "Per-developer subscription" },
  { label: "Free tier", octopus: "Free credits + free self-host", competitor: "Free trial" },
];

export default async function VsGreptilePage() {
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
            <span className="bg-gradient-to-r from-[#C0F4DA] via-[#1DFAD9] to-[#10D8BE] bg-clip-text text-transparent">
              Greptile
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-[#888]">
            Both Octopus and Greptile build on RAG to give LLMs deep codebase
            context. They differ in product focus, licensing, and deployment.
            This page lays out the differences so you can pick the right tool.
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
                    Greptile
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
                You want to self-host on your own infrastructure, for free.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                Automated PR review with severity ratings is your main use case.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                You prefer usage-based credits over per-developer seats.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                You want to bring your own Claude or OpenAI API keys.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                Open source matters for audit, compliance, or customization.
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-[#161616] p-8">
            <h2 className="text-xl font-bold tracking-tight text-white">
              When Greptile is a great fit
            </h2>
            <ul className="mt-5 space-y-3 text-sm text-[#a0a0a0]">
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#cfcfcf]" />
                You use GitLab and want mature support today.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#cfcfcf]" />
                Building your own product on top of a hosted codebase Q&A API
                is a core requirement.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#cfcfcf]" />
                You prefer a fully managed SaaS so your team can stay focused
                on product work.
              </li>
              <li className="flex gap-3">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-[#cfcfcf]" />
                Per-developer pricing is a better fit for your budgeting
                process.
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
