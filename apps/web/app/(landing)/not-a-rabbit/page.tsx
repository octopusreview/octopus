import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { CouponCode } from "./coupon-code";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";

export const metadata: Metadata = {
  title: "Not a Rabbit. Don't follow trails.",
  description:
    "Not a Rabbit. Don't follow trails. Octopus sees your entire codebase at once. AI-powered code review that wraps around every pull request.",
  keywords: [
    "Not a Rabbit",
    "Don't follow trails",
    "Octopus",
    "AI code review",
    "automated code review",
  ],
  openGraph: {
    title: "Not a Rabbit. Don't follow trails.",
    description:
      "Not a Rabbit. Don't follow trails. Octopus sees your entire codebase at once. AI-powered code review that wraps around every pull request.",
    url: "https://octopus-review.ai/not-a-rabbit",
    type: "website",
  },
  alternates: {
    canonical: "https://octopus-review.ai/not-a-rabbit",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Not a Rabbit. Don't follow trails.",
  description:
    "Not a Rabbit. Don't follow trails. Octopus sees your entire codebase at once. AI-powered code review that wraps around every pull request.",
  url: "https://octopus-review.ai/not-a-rabbit",
  publisher: {
    "@type": "Organization",
    name: "Octopus",
    url: "https://octopus-review.ai",
  },
};

export default async function NotARabbitPage() {
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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Mobile nav */}
      <LandingMobileNav isLoggedIn={!!session} />

      {/* Desktop nav */}
      <LandingDesktopNav isLoggedIn={!!session} />

      {/* Hero */}
      <section className="relative z-10 flex min-h-[80vh] flex-col items-center justify-center px-6 pb-16 pt-28 md:px-8 md:pb-24 md:pt-40">
        <div className="mx-auto max-w-3xl text-center">
          {/* Sticker badge */}
          <div className="animate-fade-in relative mx-auto mb-12 h-[280px] w-[280px] sm:h-[340px] sm:w-[340px] md:h-[400px] md:w-[400px]">
            {/* Outer ring */}
            <div className="absolute inset-0 rounded-full border border-white/[0.08]" />

            {/* Rotating text */}
            <svg
              className="absolute inset-0 h-full w-full animate-[spin_25s_linear_infinite]"
              viewBox="0 0 400 400"
            >
              <defs>
                <path
                  id="textCircle"
                  d="M 200,200 m -165,0 a 165,165 0 1,1 330,0 a 165,165 0 1,1 -330,0"
                  fill="none"
                />
              </defs>
              <text
                className="fill-white text-[1.05rem] font-bold uppercase tracking-[0.2em]"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                <textPath
                  href="#textCircle"
                  textLength={2 * Math.PI * 165}
                  lengthAdjust="spacing"
                >
                  {"\u00A0Not a Rabbit. Don\u2019t follow trails \u2022 Not a Rabbit. Don\u2019t follow trails \u2022 "}
                </textPath>
              </text>
            </svg>

            {/* Center logo */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-[190px] w-[190px] items-center justify-center rounded-full border border-white/[0.06] bg-[#161616] sm:h-[225px] sm:w-[225px] md:h-[260px] md:w-[260px]">
                <Image
                  src="/logo.svg"
                  alt="Octopus"
                  width={105}
                  height={111}
                  className="sm:h-[125px] sm:w-[119px] md:h-[145px] md:w-[138px]"
                />
              </div>
            </div>
          </div>

          {/* SEO heading (visible) */}
          <h1 className="animate-fade-in text-4xl font-bold tracking-tight text-white [animation-delay:100ms] sm:text-5xl md:text-6xl">
            Not a Rabbit.
            <br />
            <span className="bg-gradient-to-r from-[#C0F4DA] via-[#1DFAD9] to-[#10D8BE] bg-clip-text text-transparent">
              Don&apos;t follow trails.
            </span>
          </h1>

          <p className="animate-fade-in mx-auto mt-8 max-w-xl text-lg text-[#888] [animation-delay:200ms]">
            Rabbits chase one trail at a time. Octopus wraps around your entire
            codebase at once. Eight arms. Every file. Every pull request. No
            blind spots.
          </p>

          <p className="animate-fade-in mx-auto mt-4 max-w-lg text-[#666] [animation-delay:300ms]">
            AI-powered code review that sees what single-track reviewers miss.
          </p>

          {/* Coupon */}
          <div className="animate-fade-in mx-auto mt-10 max-w-sm rounded-2xl border border-white/[0.06] bg-white/[0.02] px-8 py-6 text-center [animation-delay:400ms]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
              You found the sticker
            </p>
            <CouponCode />
            <p className="mt-3 text-sm text-[#888]">
              Claim <span className="font-semibold text-white">$50 free credits</span> after signing up.
            </p>
          </div>

          <div className="animate-fade-in mt-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-center [animation-delay:500ms]">
            <Link
              href={session ? "/dashboard" : "/login"}
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition-all hover:bg-[#e0e0e0]"
            >
              {session ? "Go to Dashboard" : "Claim & Get Started"}
            </Link>
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-8 py-3 text-sm font-medium text-[#999] transition-all hover:border-white/[0.2] hover:text-white"
            >
              Learn more
            </Link>
          </div>
        </div>
      </section>

      {/* The Story */}
      <section className="relative z-10 px-4 pb-12 sm:px-8 md:px-12 md:pb-16">
        <div className="mx-auto max-w-3xl">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
            The Story
          </span>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Where &ldquo;Not a Rabbit&rdquo; came from
          </h2>

          <div className="mt-8 space-y-5 text-[#999] leading-relaxed">
            <p>
              The phrase started as an internal joke. We were building Octopus,
              an AI code reviewer, and watching how other tools worked. Most of
              them did the same thing: take a pull request, look at the diff,
              maybe peek at the few files the diff touches, and start commenting.
              One trail, followed in a straight line.
            </p>
            <p>
              That is what a rabbit does. A rabbit picks a direction and runs.
              It is fast, it commits, and it almost always misses what is
              happening five steps to the left. In code review, &ldquo;five steps
              to the left&rdquo; is usually where the real bug lives. The
              function you renamed is called from a service you did not open.
              The migration you wrote breaks an assumption in a worker queue.
              The new auth check duplicates a guard that already exists three
              folders away.
            </p>
            <p>
              We wanted a name and an animal that pushed back against this. An
              octopus does not chase a single trail. It wraps around an object
              and senses it from every angle at once. Eight arms, hundreds of
              suckers, distributed cognition. That is exactly what a code review
              tool needs to do: see the whole repository at the same time, not
              one diff in isolation.
            </p>
            <p>
              So &ldquo;Not a Rabbit. Don&rsquo;t follow trails&rdquo; became
              shorthand for the entire product philosophy. Octopus indexes your
              full codebase, builds a semantic map of every file, then reviews
              your pull request with that whole map in memory. It is not faster
              because it skips work. It is better because it does not need to
              guess what the surrounding code looks like.
            </p>
            <p>
              We printed the phrase on stickers and brought them to AWS Summit.
              If you found one and ended up here, that is the whole story. The
              sticker is the bait. The thesis is on this page. The product is
              one click away.
            </p>
          </div>
        </div>
      </section>

      {/* Explanation */}
      <section className="relative z-10 px-4 pb-16 sm:px-8 md:px-12 md:pb-24">
        <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-16 md:px-12 md:py-20">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
            Why Octopus
          </span>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Eight arms beat four legs
          </h2>
          <p className="mt-4 max-w-2xl text-[#888]">
            A rabbit follows a single trail, hoping it leads somewhere. Octopus
            doesn&apos;t hope. It indexes your entire repository, understands the
            context across every file, and reviews every pull request with full
            codebase awareness.
          </p>

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-white/[0.06] p-6">
              <p className="text-3xl font-bold text-white">360&deg;</p>
              <p className="mt-2 text-sm text-[#888]">
                Full codebase context on every review. No tunnel vision.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] p-6">
              <p className="text-3xl font-bold text-white">8 arms</p>
              <p className="mt-2 text-sm text-[#888]">
                Security, bugs, style, performance, logic, types, tests, docs.
                All at once.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] p-6">
              <p className="text-3xl font-bold text-white">0 trails</p>
              <p className="mt-2 text-sm text-[#888]">
                No rabbit holes. No wasted time. Findings posted directly on
                your PR.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 px-6 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Stop following trails.
            <br />
            Start seeing everything.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[#666]">
            Octopus is open source, free to self-host, and ready to review your
            next pull request.
          </p>
          <div className="mt-8">
            <Link
              href={session ? "/dashboard" : "/login"}
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition-all hover:bg-[#e0e0e0]"
            >
              {session ? "Go to Dashboard" : "Try Octopus Free"}
            </Link>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
