import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { FloatingOctopus } from "@/components/landing-unicorn-section";
import { LandingFeatures } from "@/components/landing-features";
import { TrackedLink, TrackedAnchor } from "@/components/tracked-link";
import { LandingFooter } from "@/components/landing-footer";
import { LaunchCountdown } from "@/components/landing-countdown";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { WebGLToggleButton } from "@/components/webgl-toggle-button";
import { RotatingHeroText } from "@/components/landing-rotating-hero";
import { NewsletterForm } from "@/components/landing-newsletter";

import { ReviewEngineReveal } from "@/components/ReviewEngineReveal";
import { FaqList } from "@/components/FaqList";
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

const landingFaqs = [
  {
    q: "What is Octopus?",
    a: "Octopus is an AI-powered code review tool that connects to GitHub and Bitbucket, indexes your codebase for deep context, and automatically reviews every pull request — posting findings as inline comments with severity levels.",
  },
  {
    q: "How does the automated review work?",
    a: "When a pull request is opened, Octopus fetches the diff, retrieves relevant context from your indexed codebase using vector search, and sends it to an LLM (Claude or OpenAI) for analysis. Findings are posted directly on the PR with severity ratings: Critical, Major, Minor, Suggestion, and Tip.",
  },
  {
    q: "Which programming languages are supported?",
    a: "Octopus is language-agnostic. It reviews any text-based code file — TypeScript, Python, Go, Rust, Java, C#, Ruby, PHP, Swift, Kotlin, and more. Since it uses LLMs for analysis, it understands the semantics and patterns of virtually any language.",
  },
  {
    q: "Is my source code safe?",
    a: "Yes. Your code is processed in-memory and never stored permanently. Only vector embeddings are persisted for search. You can also self-host Octopus on your own infrastructure so your code never leaves your servers.",
  },
  {
    q: "Does Octopus replace human reviewers?",
    a: "No. Octopus augments your team's review process. It catches bugs, security issues, and style inconsistencies so your human reviewers can focus on architecture, design decisions, and business logic.",
  },
  {
    q: "Is Octopus free to use?",
    a: "Yes. Octopus is open source under the MIT license and free to self-host. The cloud service includes free credits to get started, with a credit-based model for continued use. You can also bring your own API keys to use your existing AI provider billing.",
  },
];

const productJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Octopus",
  url: "https://octopus-review.ai",
  logo: "https://octopus-review.ai/logo.svg",
  description:
    "AI-powered code review tool that connects to GitHub and Bitbucket, indexes your codebase, and automatically reviews pull requests with severity-rated findings.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "Automated pull request review",
    "Codebase indexing with vector search",
    "Severity-rated findings (Critical, Major, Minor, Suggestion, Tip)",
    "GitHub and Bitbucket integration",
    "Slack and Linear integration",
    "Self-hostable with Docker",
    "Bring Your Own API keys",
    "Real-time WebSocket updates",
    "Knowledge base for custom review rules",
    "CLI for terminal-based workflows",
  ],
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: landingFaqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: f.a,
    },
  })),
};

export default async function LandingPage() {
  const [session, blogPosts] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    prisma.blogPost.findMany({
      where: { status: "published", deletedAt: null },
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: { title: true, slug: true, excerpt: true, publishedAt: true, authorName: true },
    }),
  ]);
  return (
    <div className="dark relative min-h-screen bg-[#0c0c0c] text-[#a0a0a0] selection:bg-white/20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* Floating particle octopus — follows scroll across entire page */}
      <FloatingOctopus />

      {/* Grain overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.025]"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Mobile nav — hamburger menu */}
      <LandingMobileNav isLoggedIn={!!session} />

      {/* Desktop nav — floating pill */}
      <LandingDesktopNav isLoggedIn={!!session} />

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

          <p className="animate-fade-in mx-auto mt-6 h-14 max-w-2xl text-base text-[#666] [animation-delay:200ms] sm:text-lg">
            <RotatingHeroText
              texts={[
                "Octopus reviews every pull request with deep context awareness.\nCatch bugs, enforce standards, and ship with confidence.",
                "Learns your codebase and reviews PRs like your senior engineer",
                "Catches bugs, security issues, and anti-patterns before production",
                "Deep context awareness across your entire codebase",
                "Indexes every file, function, and relationship in your repo",
                "Posts inline comments with severity levels directly on your PRs",
                "Works with GitHub and Bitbucket out of the box",
                "Open source and self-hostable, your code never leaves your servers",
                "Improves over time with team feedback on every finding",
                "Powered by Claude, understands any language, any framework",
                "Reviews every PR in under 2 minutes, 24/7",
              ]}
              interval={3000}
            />
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
      <section id="how-it-works" className="relative z-10 scroll-mt-20 px-4 sm:px-8 md:px-12">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-20 md:px-12 md:py-28">
          <div className="absolute right-4 top-4 z-10 md:right-6 md:top-6">
            <WebGLToggleButton />
          </div>
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

            {/* Review Engine — expandable */}
            <ReviewEngineReveal />
          </div>
        </div>
      </section>

      {/* Features — DARK panel, split layout like skillo */}
      <section id="features" className="relative z-10 scroll-mt-20 px-4 py-8 sm:px-8 md:px-12">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#161616] px-6 py-20 md:px-12 md:py-28">
          <LandingFeatures />
        </div>
      </section>

      {/* Open Source */}
      <section id="open-source" className="relative z-10 scroll-mt-20 px-4 sm:px-8 md:px-12">
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

              {/* Open Source Launch Countdown */}
              <div className="mt-10 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-8">
                <p className="mb-5 text-sm font-medium text-[#888]">
                  Core codebase goes public on <span className="text-white">March 23, 2026 — 15:00 UTC</span>
                </p>
                <LaunchCountdown />
              </div>
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

      {/* Blog */}
      {blogPosts.length > 0 && (
        <section className="relative z-10 px-4 py-8 sm:px-8 md:px-12">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-20 md:px-12 md:py-28">
            <div className="mx-auto max-w-5xl">
              <div className="mx-auto max-w-2xl text-center">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">Blog</span>
                <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  From the blog
                </h2>
                <p className="mt-4 text-[#888]">
                  Engineering insights and lessons from building Octopus.
                </p>
              </div>

              <div className="mt-14 grid gap-4 md:grid-cols-3">
                {blogPosts.map((post) => (
                  <Link
                    key={post.slug}
                    href={`/blog/${post.slug}`}
                    className="group rounded-xl border border-white/[0.06] p-6 transition-colors hover:border-white/[0.12] hover:bg-white/[0.02]"
                  >
                    <h3 className="font-semibold text-white transition-colors group-hover:text-[#10D8BE]">
                      {post.title}
                    </h3>
                    {post.excerpt && (
                      <p className="mt-2 text-sm text-[#888] line-clamp-2">{post.excerpt}</p>
                    )}
                    <div className="mt-4 flex items-center gap-2 text-xs text-[#555]">
                      <span>{post.authorName}</span>
                      <span>·</span>
                      <time>
                        {post.publishedAt
                          ? new Date(post.publishedAt).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })
                          : ""}
                      </time>
                    </div>
                  </Link>
                ))}
              </div>

              <div className="mt-10 text-center">
                <TrackedLink
                  href="/blog"
                  event="blog_click"
                  eventParams={{ label: "view_all_posts" }}
                  className="inline-flex items-center gap-2 text-sm text-[#666] transition-colors hover:text-white"
                >
                  View all posts
                  <IconArrowRight className="size-3.5" />
                </TrackedLink>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section id="faq" className="relative z-10 scroll-mt-20 px-4 py-8 sm:px-8 md:px-12">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-20 md:px-12 md:py-28">
          <div className="mx-auto max-w-3xl">
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">FAQ</span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Frequently asked questions
              </h2>
              <p className="mt-4 text-[#888]">
                Quick answers to the most common questions about Octopus.
              </p>
            </div>

            <FaqList faqs={landingFaqs} visibleCount={3} />

            <div className="mt-10 text-center">
              <TrackedLink
                href="/docs/faq"
                event="faq_click"
                eventParams={{ label: "view_all_faqs" }}
                className="inline-flex items-center gap-2 text-sm text-[#666] transition-colors hover:text-white"
              >
                View all FAQs
                <IconArrowRight className="size-3.5" />
              </TrackedLink>
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

      {/* Newsletter */}
      <section className="relative z-10 px-6 pb-16 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-lg font-semibold text-white">Stay in the loop</h2>
          <p className="mt-2 text-sm text-[#666]">
            Get notified about new features, updates, and the open source launch.
          </p>
          <div className="mt-6">
            <NewsletterForm />
          </div>
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

