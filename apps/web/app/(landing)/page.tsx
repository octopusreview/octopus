import "server-only";
import Link from "@/components/link";
import { ORGANIZATION_ENTITY } from "@/lib/structured-data";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { getLandingStats } from "@/lib/landing-stats";
import { LandingFeatures } from "@/components/landing-features";
import { TrackedLink, TrackedAnchor } from "@/components/tracked-link";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { LandingAgentPrompt } from "@/components/landing-agent-prompt";
import { LandingTerminalHero } from "@/components/landing-terminal-hero";
import { NewsletterForm } from "@/components/landing-newsletter";
import { CliInstallSection } from "@/components/landing-cli-install";
import { LandingStats } from "@/components/landing-stats";
import { LandingAnnouncementBar } from "@/components/landing-announcement-bar";
import { loadActiveAnnouncements } from "@/lib/announcements";

import { FaqList } from "@/components/FaqList";
import {
  IconBrandGithub,
  IconArrowRight,
  IconCloud,
  IconServer,
  IconCheck,
  IconPlugConnected,
  IconRocket,
  IconBrain,
} from "@tabler/icons-react";

const landingFaqs = [
  {
    q: "What is Octopus?",
    a: "Octopus is an AI-powered code review tool that connects to GitHub, GitLab, Bitbucket, and Forgejo, indexes your codebase for deep context, and automatically reviews every pull request — posting findings as inline comments with severity levels.",
  },
  {
    q: "How does the automated review work?",
    a: "When a pull request is opened, Octopus fetches the diff, retrieves relevant context from your indexed codebase using vector search, and sends it to an LLM (Anthropic Claude, OpenAI GPT, Google Gemini, xAI Grok, Alibaba Qwen, or any model on OpenRouter) for analysis. Findings are posted directly on the PR with severity ratings: Critical, Major, Minor, Suggestion, and Tip.",
  },
  {
    q: "Which programming languages are supported?",
    a: "Octopus is language-agnostic. It reviews any text-based code file — TypeScript, Python, Go, Rust, Java, C#, Ruby, PHP, Swift, Kotlin, and more. Since it uses LLMs for analysis, it understands the semantics and patterns of virtually any language.",
  },
  {
    q: "Is my source code safe?",
    a: "Octopus reads repository content to index and review your code. Your configured AI services process code and review context. Self-hosting Forgejo does not change that: use self-hosted Octopus with local AI services if you need processing to stay on your infrastructure. See our security and data-retention documentation for details.",
  },
  {
    q: "Does Octopus replace human reviewers?",
    a: "No. Octopus augments your team's review process. It catches bugs, security issues, and style inconsistencies so your human reviewers can focus on architecture, design decisions, and business logic.",
  },
  {
    q: "Is Octopus free to use?",
    a: "Yes. Octopus is source-available under a Modified MIT License and free to self-host. The cloud service includes free credits to get started, with a credit-based model for continued use. You can also bring your own API keys to use your existing AI provider billing.",
  },
];

const productJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Octopus",
  url: "https://octopus-review.ai",
  logo: "https://octopus-review.ai/brand/octopus-mark.png",
  description:
    "AI-powered code review tool that connects to GitHub, GitLab, Bitbucket, and Forgejo, indexes your codebase, and automatically reviews pull requests with severity-rated findings.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    url: "https://octopus-review.ai/docs/pricing",
  },
  featureList: [
    "Automated pull request review",
    "Codebase indexing with vector search",
    "Severity-rated findings (Critical, Major, Minor, Suggestion, Tip)",
    "GitHub, GitLab, Bitbucket, and Forgejo integration",
    "Slack and Linear integration",
    "Self-hostable with Docker",
    "Bring Your Own API keys",
    "Real-time WebSocket updates",
    "Knowledge base for custom review rules",
    "CLI for terminal-based workflows",
    "Choice of AI vendor: Anthropic Claude, OpenAI GPT, Google Gemini, xAI Grok, Alibaba Qwen, or OpenRouter",
  ],
  publisher: ORGANIZATION_ENTITY,
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
  const [session, blogPosts, landingStats, announcements] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    prisma.blogPost.findMany({
      where: { status: "published", deletedAt: null },
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: { title: true, slug: true, excerpt: true, publishedAt: true, authorName: true },
    }),
    getLandingStats(),
    loadActiveAnnouncements(),
  ]);
  return (
    <div className="dark relative min-h-screen bg-background text-[#a0a0a0] selection:bg-white/20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* Grain overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.025]"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Announcement bar — managed in admin /announcements */}
      <LandingAnnouncementBar announcements={announcements} />

      {/* Mobile nav — hamburger menu */}
      <LandingMobileNav isLoggedIn={!!session} />

      {/* Desktop nav — floating pill */}
      <LandingDesktopNav isLoggedIn={!!session} />

      {/* Hero — dark bg */}
      <section className="relative z-10 px-6 pb-20 pt-40 md:px-8 md:pb-28 md:pt-52">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-12">
         <div className="text-center lg:text-left">
          <h1 className="animate-fade-in text-4xl font-bold leading-[1.1] tracking-tight text-white [animation-delay:100ms] sm:text-5xl md:text-6xl">
            Give your AI this prompt.
            <br />
            <span className="text-primary">Let it handle the rest.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[#a0a0a0] sm:text-lg lg:mx-0">
            Set up Octopus with the AI already working in your project.
            It installs the CLI, connects your GitHub repository, and gets
            your code indexed and analysed for context-aware PR reviews.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-[#a0a0a0]">
            You approve sign-in and GitHub access through the links it gives you.
            Your AI handles the commands and checks when everything is ready.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm lg:justify-start">
            <a href="#agent-setup" className="relative text-white underline underline-offset-4 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Get the setup prompt</a>
            <a href="#cli" className="relative text-[#a0a0a0] underline underline-offset-4 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Install the CLI yourself</a>
          </div>
         </div>

          <div className="min-w-0 animate-fade-in [animation-delay:400ms]">
            <LandingAgentPrompt />
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-3xl px-6 pb-12" aria-label="Example AI setup session">
        <p className="mb-4 text-center text-sm text-[#a0a0a0]">An example of your AI handling setup through octp</p>
        <LandingTerminalHero />
      </section>

      {/* Native CLI installers remain available */}
      <CliInstallSection />

      {/* How it works */}
      <section id="how-it-works" className="relative z-10 scroll-mt-20 px-4 pb-6 sm:px-8 md:px-12">
        <div className="relative mx-auto max-w-6xl">
          <LandingStats initial={landingStats} />
        </div>
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-20 md:px-12 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">How it works</span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Your AI does the setup
              </h2>
              <p className="mt-4 text-[#888]">
                Give the prompt to Codex, Claude Code, or another AI with terminal access in your project.
              </p>
            </div>

            <div className="mt-16 grid gap-4 lg:grid-cols-3">
              <StepCard
                step="01"
                icon={<IconPlugConnected className="size-5" />}
                title="Share the prompt"
                description="Your AI reads the GitHub remote in your current project and installs octp. No need to paste your code into the prompt."
              >
              </StepCard>
              <StepCard
                step="02"
                icon={<IconBrain className="size-5" />}
                title="Approve access"
                description="Your AI gives you the sign-in and GitHub App links. Authorise your organisation and repository, then let the AI continue."
              />
              <StepCard
                step="03"
                icon={<IconRocket className="size-5" />}
                title="Let your AI finish"
                description="Your AI starts or joins indexing and analysis, checks progress, and reports the real result. Octopus then reviews new PRs with repository context."
              />
            </div>

          </div>
        </div>
      </section>

      {/* Features — DARK panel, split layout like skillo */}
      <section id="features" className="relative z-10 scroll-mt-20 px-4 py-6 sm:px-8 md:px-12">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[#161616] px-6 py-20 md:px-12 md:py-28">
          <LandingFeatures />
        </div>
      </section>

      {/* Two ways to run — Cloud vs Self-Host */}
      <section id="cloud-or-self-host" className="relative z-10 scroll-mt-20 px-4 py-6 sm:px-8 md:px-12">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-20 md:px-12 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">Cloud or self-host</span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Two ways to run Octopus
              </h2>
              <p className="mt-4 text-[#666] sm:text-lg">
                Use our managed cloud, or run the entire platform on your own
                infrastructure.
              </p>
              <p className="mt-4 text-sm text-[#888]">
                Hosting your code on Forgejo?{" "}
                <Link href="/docs/integrations#forgejo" className="text-primary underline underline-offset-4">
                  Connect your Forgejo instance
                </Link>{" "}
                through public HTTPS, a local connector for Cloud with private LAN/VPN access, or your own Octopus deployment.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2">
              {/* Cloud — primary */}
              <div className="relative flex flex-col rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/[0.06] to-transparent p-8">
                <span className="absolute right-6 top-6 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
                  Recommended
                </span>
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <IconCloud className="size-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-white">Cloud</h3>
                <p className="mt-1.5 text-sm text-[#888]">Octopus is hosted for you. Private Forgejo instances use a local connector.</p>
                <ul className="mt-6 space-y-3 text-sm text-[#bbb]">
                  {[
                    "Reviews for GitHub, GitLab, Bitbucket and Forgejo",
                    "Free credits to start — usage-based after, no card",
                    "Managed updates, backups and scaling",
                    "Retention follows your deployment and configuration",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2.5">
                      <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm text-[#888]">
                  Octopus stores review and indexing data.{" "}
                  <Link href="/docs/data-retention" className="underline underline-offset-4">
                    Read about data retention
                  </Link>.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <TrackedLink
                    href="/login"
                    event="cta_click"
                    eventParams={{ location: "cloud_or_self_host", label: "cloud_get_started" }}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-primary/90"
                  >
                    Get started free
                    <IconArrowRight className="size-4" />
                  </TrackedLink>
                  <TrackedLink
                    href="/docs/pricing"
                    event="cta_click"
                    eventParams={{ location: "cloud_or_self_host", label: "see_pricing" }}
                    className="text-sm text-[#888] transition-colors hover:text-white"
                  >
                    See pricing
                  </TrackedLink>
                </div>
              </div>

              {/* Self-Host — secondary */}
              <div className="flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.01] p-8">
                <div className="flex size-11 items-center justify-center rounded-xl bg-white/[0.04] text-[#999]">
                  <IconServer className="size-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-white">Self-host</h3>
                <p className="mt-1.5 text-sm text-[#888]">Run it on your own servers. Free and source-available.</p>
                <ul className="mt-6 space-y-3 text-sm text-[#bbb]">
                  {[
                    "Free & source-available (Modified MIT License)",
                    "Deploy with Docker Compose",
                    "Choose where code is processed and which AI services run",
                    "Bring your own AI keys or run local models",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2.5">
                      <IconCheck className="mt-0.5 size-4 shrink-0 text-[#666]" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <TrackedLink
                    href="/docs/self-hosting"
                    event="cta_click"
                    eventParams={{ location: "cloud_or_self_host", label: "self_host_guide" }}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] px-5 py-2.5 text-sm font-medium text-[#ccc] transition-colors hover:border-white/[0.2] hover:text-white"
                  >
                    Read the self-host guide
                    <IconArrowRight className="size-4" />
                  </TrackedLink>
                  <TrackedAnchor
                    href="https://github.com/octopusreview"
                    target="_blank"
                    rel="noopener noreferrer"
                    event="cta_click"
                    eventParams={{ location: "cloud_or_self_host", label: "star_on_github" }}
                    className="inline-flex items-center gap-1.5 text-sm text-[#888] transition-colors hover:text-white"
                  >
                    <IconBrandGithub className="size-4" />
                    GitHub
                  </TrackedAnchor>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Blog */}
      {blogPosts.length > 0 && (
        <section className="relative z-10 px-4 py-6 sm:px-8 md:px-12">
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
                    <h3 className="font-semibold text-white transition-colors group-hover:text-primary">
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
      <section id="faq" className="relative z-10 scroll-mt-20 px-4 py-6 sm:px-8 md:px-12">
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

            <div className="mt-10 flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:gap-8">
              <TrackedLink
                href="/docs/faq"
                event="faq_click"
                eventParams={{ label: "view_all_faqs" }}
                className="inline-flex items-center gap-2 text-sm text-[#666] transition-colors hover:text-white"
              >
                View all FAQs
                <IconArrowRight className="size-3.5" />
              </TrackedLink>
              <TrackedLink
                href="/compare"
                event="compare_click"
                eventParams={{ location: "landing_faq", label: "compare_hub" }}
                className="inline-flex items-center gap-2 text-sm text-[#666] transition-colors hover:text-white"
              >
                Compare with other tools
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
            Your next step is one prompt.
          </h2>
          <p className="mt-4 text-[#666] sm:text-lg">Paste it into your AI’s session in the project you want to connect.</p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <TrackedLink
              href="#agent-setup"
              event="cta_click"
              eventParams={{ location: "bottom_cta", label: "agent_setup_prompt" }}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-background transition-colors hover:bg-[#e0e0e0]"
            >
              Get the setup prompt
              <IconArrowRight className="size-4" />
            </TrackedLink>
          </div>
          <p className="mt-6 text-xs text-[#444]">No credit card required. Or self-host for free.</p>
        </div>
      </section>

      {/* Newsletter */}
      <section className="relative z-10 px-6 pb-16 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-lg font-semibold text-white">Stay in the loop</h2>
          <p className="mt-2 text-sm text-[#666]">
            Get notified about new features and product updates.
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

function StepCard({
  step,
  icon,
  title,
  description,
  children,
}: {
  step: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="group rounded-xl border border-white/[0.08] bg-white/[0.04] p-6 backdrop-blur-sm transition-colors hover:border-white/[0.15] hover:bg-white/[0.07]">
      <div className="flex items-center gap-4">
        <span className="text-3xl font-black text-white/[0.06]">{step}</span>
        <div className="flex size-10 items-center justify-center rounded-lg bg-white/[0.06] text-[#888] transition-colors group-hover:bg-white group-hover:text-background">
          {icon}
        </div>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[#888]">{description}</p>
      {children}
    </div>
  );
}
