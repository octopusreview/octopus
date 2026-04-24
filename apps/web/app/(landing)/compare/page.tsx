import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { IconArrowRight } from "@tabler/icons-react";

export const metadata: Metadata = {
  title: "Compare Octopus — AI Code Review Comparisons",
  description:
    "See how Octopus compares to other AI code review tools. Side-by-side looks at features, pricing, architecture, self-hosting, and open source licensing.",
  keywords: [
    "AI code review comparison",
    "Octopus vs",
    "code review tool comparison",
    "CodeRabbit alternative",
    "Greptile alternative",
  ],
  openGraph: {
    title: "Compare Octopus — AI Code Review Comparisons",
    description:
      "See how Octopus compares to other AI code review tools. Side-by-side looks at features, pricing, architecture, and deployment.",
    url: "https://octopus-review.ai/compare",
    type: "website",
  },
  alternates: {
    canonical: "https://octopus-review.ai/compare",
  },
};

const comparisons = [
  {
    slug: "vs-coderabbit",
    competitor: "CodeRabbit",
    gradient: "from-[#FFD4A8] via-[#FF8A3D] to-[#F15A24]",
    tagline: "Managed SaaS with Dynamic Discovery",
    description:
      "Both tools review PRs with LLMs, but take different approaches to codebase context. Compare pricing, self-hosting, and more.",
  },
  {
    slug: "vs-greptile",
    competitor: "Greptile",
    gradient: "from-[#C0F4DA] via-[#1DFAD9] to-[#10D8BE]",
    tagline: "RAG-based codebase intelligence SaaS",
    description:
      "Both use RAG for deep codebase context. Compare product focus, licensing, deployment, and pricing models.",
  },
];

export default async function ComparePage() {
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);

  return (
    <div className="dark relative min-h-screen bg-[#0c0c0c] text-[#a0a0a0] selection:bg-white/20">
      <LandingMobileNav isLoggedIn={!!session} />
      <LandingDesktopNav isLoggedIn={!!session} />

      <section className="relative z-10 px-6 pt-32 pb-16 md:px-8 md:pt-40 md:pb-20">
        <div className="mx-auto max-w-4xl text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
            Compare
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            How Octopus compares
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-[#888]">
            Honest, side-by-side comparisons with other AI code review tools.
            See where each one shines so you can pick what fits your team.
          </p>
        </div>
      </section>

      <section className="relative z-10 px-4 pb-20 sm:px-8 md:px-12">
        <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-2">
          {comparisons.map((c) => (
            <Link
              key={c.slug}
              href={`/${c.slug}`}
              className="group block rounded-2xl border border-white/[0.06] bg-[#161616] p-8 transition-all hover:border-white/[0.12] hover:bg-[#1a1a1a]"
            >
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
                Comparison
              </span>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-white">
                Octopus <span className="text-[#555]">vs</span>{" "}
                <span className={`bg-gradient-to-r ${c.gradient} bg-clip-text text-transparent`}>
                  {c.competitor}
                </span>
              </h2>
              <p className="mt-2 text-sm font-medium text-[#cfcfcf]">
                {c.tagline}
              </p>
              <p className="mt-4 text-sm text-[#a0a0a0]">{c.description}</p>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-white transition-colors group-hover:text-[#10D8BE]">
                See the comparison
                <IconArrowRight className="size-4" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="relative z-10 px-6 pb-24 md:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Don&apos;t see the tool you&apos;re evaluating?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[#888]">
            More comparisons are on the way. In the meantime, try Octopus on
            your next pull request and see for yourself.
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
