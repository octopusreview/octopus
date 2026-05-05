import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  IconBrandGithub,
  IconArrowRight,
  IconChecks,
  IconBolt,
  IconShieldCheck,
  IconCode,
  IconLockOpen,
  IconCircleCheck,
} from "@tabler/icons-react";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { LandingOssWorkflowSnippet } from "@/components/landing-oss-workflow-snippet";
import { TrackedLink, TrackedAnchor } from "@/components/tracked-link";
import { FaqList } from "@/components/FaqList";

export const metadata = {
  title: "Free for Open Source | Octopus",
  description:
    "Octopus reviews every pull request on every public OSI-licensed repository. Free, unlimited, forever. No credit card, no monthly quota.",
  alternates: {
    canonical: "https://octopus-review.ai/open-source",
  },
  openGraph: {
    title: "Free unlimited AI code reviews for open source projects",
    description:
      "Public OSI-licensed repos get unlimited PR reviews from Octopus. Forever, on us.",
    url: "https://octopus-review.ai/open-source",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free unlimited AI code reviews for open source projects",
    description:
      "Public OSI-licensed repos get unlimited PR reviews from Octopus. Forever, on us.",
  },
};

const ossFaqs = [
  {
    q: "What does \"free forever\" actually mean?",
    a: "Every public, OSI-licensed repository gets unlimited Octopus reviews on every pull request, with no credit card and no monthly quota. There is no time limit, no project cap, and no \"we'll start charging in year two\" footnote. We absorb the LLM and infrastructure cost.",
  },
  {
    q: "Why OSI-licensed and not just \"public\"?",
    a: "There is a real difference between an open source project and a public repo with a non-commercial or business-source license. We use the OSI's approved license list to draw the line. MIT, Apache-2.0, GPL, BSD, MPL and similar all qualify. BSL, SSPL, and \"non-commercial use only\" licenses do not.",
  },
  {
    q: "Will you train on my code?",
    a: "No. Public code is already public, and we don't need to train on it to review it. Source is processed in-memory, embeddings are stored only for retrieval during review, and there is no model training pipeline using your repos.",
  },
  {
    q: "Can my private repo also use this?",
    a: "Private repos use the standard credit-based plan. Octopus is also MIT-licensed and self-hostable, so you can run the entire stack on your own infrastructure if you prefer.",
  },
  {
    q: "What if my project gets really big?",
    a: "It still stays free. We've sized the budget for this program assuming popular projects will use it the most, because that's where it has the most impact for maintainers.",
  },
  {
    q: "What's the catch?",
    a: "There isn't one. The selfish version: public repos are where Octopus gets battle-tested across wildly diverse codebases, and word of mouth in the OSS community is the best growth channel software has. We benefit from doing this. So do you.",
  },
];

export default async function OpenSourceLandingPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <div className="dark relative min-h-screen bg-[#0c0c0c] text-[#a0a0a0] selection:bg-white/20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: ossFaqs.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }),
        }}
      />

      {/* Grain overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.025]"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      <LandingMobileNav isLoggedIn={!!session} />
      <LandingDesktopNav isLoggedIn={!!session} />

      {/* Hero */}
      <section className="relative z-10 px-4 pt-44 pb-20 sm:px-8 md:px-12 md:pt-56 md:pb-28">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            Free, unlimited reviews
            <br />
            <span className="text-[#10D8BE]">for open source projects.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-[#aaa]">
            If your repository is public and OSI-licensed, Octopus reviews
            every pull request. Forever, on us. No credit card, no monthly
            quota, no &quot;free for the first 100 projects&quot; trick.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <TrackedAnchor
              href="https://github.com/marketplace/actions/octopus-review"
              target="_blank"
              rel="noopener noreferrer"
              event="cta_click"
              eventParams={{ location: "oss_hero", label: "marketplace" }}
              className="inline-flex items-center gap-2 rounded-full bg-[#10D8BE] px-5 py-2.5 text-sm font-medium text-[#0c0c0c] transition-colors hover:bg-[#0fbfa8]"
            >
              <IconBrandGithub className="size-4" />
              Install from GitHub Marketplace
            </TrackedAnchor>
            <TrackedLink
              href="#setup"
              event="cta_click"
              eventParams={{ location: "oss_hero", label: "setup" }}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-5 py-2.5 text-sm font-medium text-[#bbb] transition-colors hover:text-white"
            >
              See the setup
              <IconArrowRight className="size-4" />
            </TrackedLink>
          </div>

          <p className="mt-6 text-xs text-[#555]">
            One workflow file. Reviews start on the next pull request.
          </p>
        </div>
      </section>

      {/* What you get */}
      <section className="relative z-10 px-4 py-12 sm:px-8 md:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<IconChecks className="size-5" />}
              title="Unlimited PR reviews"
              description="Every opened or updated pull request on every public repo, no monthly cap."
            />
            <FeatureCard
              icon={<IconBolt className="size-5" />}
              title="One-file setup"
              description="Drop a single GitHub Action step into your workflow. No tokens, no signup."
            />
            <FeatureCard
              icon={<IconCode className="size-5" />}
              title="Source-backed comments"
              description="Inline review comments tied to actual lines, with severity levels and source citations."
            />
            <FeatureCard
              icon={<IconShieldCheck className="size-5" />}
              title="No code training"
              description="Public code stays public. We don't train models on your repos, period."
            />
          </div>
        </div>
      </section>

      {/* Setup */}
      <section
        id="setup"
        className="relative z-10 scroll-mt-20 px-4 py-12 sm:px-8 md:px-12"
      >
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-16 md:px-12 md:py-20">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
                Setup
              </span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                One workflow file.
                <br />
                That&apos;s the whole thing.
              </h2>
              <p className="mt-4 text-[#888]">
                Drop the YAML on the right into{" "}
                <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-white">
                  .github/workflows/octopus.yml
                </code>
                , commit it, and Octopus will start reviewing on the next pull
                request. The action authenticates via the ephemeral
                {" "}
                <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-white">
                  GITHUB_TOKEN
                </code>
                {" "}so there are no API keys to manage.
              </p>

              <ol className="mt-6 space-y-3 text-sm text-[#bbb]">
                <Step n={1}>
                  Add the workflow file to your default branch.
                </Step>
                <Step n={2}>
                  Open or update a pull request.
                </Step>
                <Step n={3}>
                  Octopus posts inline review comments within a couple of
                  minutes.
                </Step>
              </ol>

              <div className="mt-8">
                <TrackedLink
                  href="/docs/open-source"
                  event="cta_click"
                  eventParams={{ location: "oss_setup", label: "read_docs" }}
                  className="inline-flex items-center gap-2 text-sm font-medium text-[#10D8BE] transition-colors hover:text-white"
                >
                  Full setup guide
                  <IconArrowRight className="size-4" />
                </TrackedLink>
              </div>
            </div>

            <div>
              <LandingOssWorkflowSnippet />
            </div>
          </div>
        </div>
      </section>

      {/* Eligibility */}
      <section className="relative z-10 px-4 py-12 sm:px-8 md:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="rounded-3xl border border-[#10D8BE]/20 bg-[#10D8BE]/[0.04] p-8 md:p-10">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#10D8BE]">
                <IconCircleCheck className="size-4" />
                Qualifies
              </div>
              <h3 className="mt-4 text-2xl font-semibold text-white">
                Genuinely open source
              </h3>
              <p className="mt-3 text-sm text-[#aaa]">
                Public repositories with an{" "}
                <a
                  href="https://opensource.org/licenses"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white underline decoration-[#10D8BE]/40 underline-offset-2 transition-colors hover:decoration-[#10D8BE]"
                >
                  OSI-approved license
                </a>
                . If your project meets the{" "}
                <a
                  href="https://opensource.org/osd"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white underline decoration-[#10D8BE]/40 underline-offset-2 transition-colors hover:decoration-[#10D8BE]"
                >
                  Open Source Definition
                </a>
                , you&apos;re in.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-[#bbb]">
                <li className="flex items-start gap-2">
                  <IconChecks className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                  <span>MIT, Apache-2.0, GPL, BSD, MPL, ISC</span>
                </li>
                <li className="flex items-start gap-2">
                  <IconChecks className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                  <span>LGPL, AGPL, EUPL, Unlicense, CC0</span>
                </li>
                <li className="flex items-start gap-2">
                  <IconChecks className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
                  <span>Any other OSI-approved license</span>
                </li>
              </ul>
            </div>

            <div className="rounded-3xl border border-white/[0.06] bg-[#161616] p-8 md:p-10">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#888]">
                <IconLockOpen className="size-4" />
                Use the standard plan
              </div>
              <h3 className="mt-4 text-2xl font-semibold text-white">
                Source-available or private
              </h3>
              <p className="mt-3 text-sm text-[#aaa]">
                Projects that are visible but commercially restricted use the
                standard credit-based plan. Octopus itself is MIT-licensed and
                self-hostable if you&apos;d rather run it on your own infra.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-[#888]">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 size-4 shrink-0 text-[#444]">·</span>
                  <span>BSL, SSPL, Elastic License</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 size-4 shrink-0 text-[#444]">·</span>
                  <span>&quot;Non-commercial use only&quot; licenses</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 size-4 shrink-0 text-[#444]">·</span>
                  <span>Private repos, internal projects</span>
                </li>
              </ul>
              <div className="mt-6">
                <TrackedLink
                  href="/docs/pricing"
                  event="cta_click"
                  eventParams={{
                    location: "oss_eligibility",
                    label: "pricing",
                  }}
                  className="inline-flex items-center gap-2 text-sm font-medium text-white transition-colors hover:text-[#10D8BE]"
                >
                  See pricing
                  <IconArrowRight className="size-4" />
                </TrackedLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why we do this */}
      <section className="relative z-10 px-4 py-12 sm:px-8 md:px-12">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-16 md:px-12 md:py-20">
          <div className="mx-auto max-w-3xl">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
              Why we do this
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Maintainer burnout isn&apos;t caused by writing code.
              <br />
              <span className="text-[#888]">
                It&apos;s caused by reviewing other people&apos;s code.
              </span>
            </h2>
            <p className="mt-6 text-[#aaa]">
              Open the{" "}
              <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-white">
                package.json
              </code>{" "}
              of any project shipped in the last decade. Every dependency was
              built by someone who didn&apos;t ask for money. The bill never
              arrives, but the debt is real.
            </p>
            <p className="mt-3 text-[#aaa]">
              Octopus exists to make code review less exhausting. So giving it
              to the people who need it most felt less like generosity and more
              like the obvious move.
            </p>
            <div className="mt-8">
              <TrackedAnchor
                href="https://dev.to/redoh/why-were-giving-octopus-free-to-open-source-forever-1488"
                target="_blank"
                rel="noopener noreferrer"
                event="cta_click"
                eventParams={{ location: "oss_why", label: "read_post" }}
                className="inline-flex items-center gap-2 text-sm font-medium text-[#10D8BE] transition-colors hover:text-white"
              >
                Read the full post on dev.to
                <IconArrowRight className="size-4" />
              </TrackedAnchor>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative z-10 px-4 py-12 sm:px-8 md:px-12">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
              FAQ
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Common questions
            </h2>
          </div>
          <FaqList faqs={ossFaqs} visibleCount={6} />
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 px-6 py-24 md:px-8 md:py-28">
        <div className="relative mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Add Octopus to your project
            <br />
            in under two minutes.
          </h2>
          <p className="mt-4 text-[#888] sm:text-lg">
            Free for every public OSI-licensed repository. Forever.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <TrackedAnchor
              href="https://github.com/marketplace/actions/octopus-review"
              target="_blank"
              rel="noopener noreferrer"
              event="cta_click"
              eventParams={{ location: "oss_bottom_cta", label: "marketplace" }}
              className="inline-flex items-center gap-2 rounded-full bg-[#10D8BE] px-6 py-3 text-sm font-medium text-[#0c0c0c] transition-colors hover:bg-[#0fbfa8]"
            >
              <IconBrandGithub className="size-4" />
              Install on GitHub
            </TrackedAnchor>
            <TrackedAnchor
              href="https://github.com/octopusreview/octopus"
              target="_blank"
              rel="noopener noreferrer"
              event="cta_click"
              eventParams={{ location: "oss_bottom_cta", label: "github_repo" }}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-6 py-3 text-sm font-medium text-[#bbb] transition-colors hover:text-white"
            >
              Star on GitHub
              <IconArrowRight className="size-4" />
            </TrackedAnchor>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#141414] p-6 transition-colors hover:border-white/[0.12]">
      <div className="flex size-10 items-center justify-center rounded-lg bg-[#10D8BE]/10 text-[#10D8BE]">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[#888]">{description}</p>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-[#10D8BE]/40 bg-[#10D8BE]/10 text-[10px] font-semibold text-[#10D8BE]">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}
