import type { Metadata } from "next";
import { SessionLink } from "@/components/session-aware";
import Link from "@/components/link";
import Image from "next/image";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";
import { ORGANIZATION_ID, SITE_URL, WEBSITE_ID, jsonLd } from "@/lib/structured-data";
import { DiffSwitch } from "./diff-switch";

const PAGE_URL = `${SITE_URL}/not-a-rabbit`;
const TITLE = "Diff-only vs full-codebase AI code review | Octopus";
const DESCRIPTION =
  "Diff-only review misses bugs outside the changed lines. See what full-codebase review catches, with examples, and the trade-offs.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    "diff-only vs full codebase code review",
    "AI code review beyond the diff",
    "codebase-aware code review",
    "diff-only code review limitations",
    "Not a Rabbit",
  ],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: PAGE_URL,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  alternates: {
    canonical: PAGE_URL,
  },
};

const misses = [
  {
    title: "A changed signature",
    inDiff: "charge() gains an argument",
    outside: "the refund worker",
    text: "The pull request updates one caller and a test. Another caller, in the refund worker, is not in the diff and still passes the old arguments.",
  },
  {
    title: "A shared helper",
    inDiff: "formatMoney() rounds differently",
    outside: "the invoice export",
    text: "The invoice export uses the same helper. It is not in the diff, and its totals no longer match the ledger.",
  },
  {
    title: "A schema change",
    inDiff: "orders.total can now be empty",
    outside: "a nightly job",
    text: "A nightly job three folders away assumes the column always has a value.",
  },
];

const steps = [
  {
    name: "Index",
    text: "Octopus splits the repository into chunks and stores an embedding of each one, so related code can be found by meaning.",
  },
  {
    name: "Find",
    text: "For each pull request it looks up the code most related to the change, wherever it lives in the repository.",
  },
  {
    name: "Review",
    text: "The model reviews the diff with that code in view and posts its findings on the pull request.",
  },
];

const glance = [
  ["Reads", "The changed lines", "The changed lines, plus related code elsewhere in the repository"],
  ["Can flag", "Bugs visible in the diff", "Also bugs visible in related code"],
  ["Speed and cost", "Faster and cheaper", "Needs an index first, and each review carries more context"],
  ["Best when", "The change is small and self-contained", "The change touches shared code"],
];

const compare = [
  { href: "/vs-coderabbit", title: "Octopus vs CodeRabbit", text: "The two tools side by side." },
  { href: "/coderabbit-alternatives", title: "CodeRabbit alternatives", text: "Other reviewers worth a look." },
  { href: "/self-hosted-ai-code-review", title: "Self-hosted AI code review", text: "Run it on your own infrastructure." },
];

const faqs = [
  {
    q: "Is full-codebase review always better than diff-only review?",
    a: "No. If the diff shows everything you need to check a small change, a diff-only review is faster and cheaper. More context helps when you need to check an unchanged caller or even an earlier line in the same function.",
  },
  {
    q: "Does Octopus send my whole repository to a model?",
    a: "Not in one request. During indexing, Octopus sends your code to the embedding service in chunks. During a review, the diff and the chunks found for it go to the AI service you configured. Self-hosted Octopus with local AI services keeps that processing on your infrastructure.",
  },
  {
    q: "What does Octopus index?",
    a: "Octopus indexes supported code files and skips folders such as node_modules, dist and build. Each chunk has a target size of 1,500 characters. For multiline code, the next chunk carries over up to three lines. When Octopus splits a single long line, the pieces overlap by 200 characters.",
  },
  {
    q: "Does full-codebase review cost more?",
    a: "Somewhat. Indexing uses embedding calls, and each review sends more context to the model than the diff alone. On Octopus Cloud these use credits. If you bring your own provider key, the review-model call is billed by your provider instead; platform embeddings still use credits.",
  },
];

const pageJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": PAGE_URL,
      url: PAGE_URL,
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { "@id": WEBSITE_ID },
      publisher: { "@id": ORGANIZATION_ID },
      inLanguage: "en",
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Review beyond the diff", item: PAGE_URL },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

const kicker = "text-xs font-semibold uppercase tracking-[0.2em] text-[#555]";
const h2 = "mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl";
const card = "rounded-2xl border border-white/[0.06] bg-[#161616] p-6";

export default async function NotARabbitPage() {

  return (
    <div className="dark relative min-h-screen bg-background text-[#a0a0a0] selection:bg-white/20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(pageJsonLd) }} />

      <LandingMobileNav />
      <LandingDesktopNav />

      {/* Hero: the answer first, then one picture */}
      <section className="relative z-10 px-6 pb-16 pt-32 md:px-8 md:pb-20 md:pt-40">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="animate-fade-in text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            Not a Rabbit.
            <br />
            <span className="text-primary">Review beyond the diff.</span>
          </h1>

          <p className="animate-fade-in mx-auto mt-8 max-w-2xl text-lg text-[#888] [animation-delay:100ms]">
            A diff-only reviewer reads the lines a pull request changes. A
            full-codebase reviewer also looks up the code around them, such as
            callers, tests and the files that depend on the change. That is
            often where the bug is.
          </p>

          <DiffSwitch />

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <SessionLink
              signedOutLabel="Get started"
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition-all hover:bg-[#e0e0e0]"
            />
            <Link
              href="#compare"
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-8 py-3 text-sm font-medium text-[#999] transition-all hover:border-white/[0.2] hover:text-white"
            >
              See how it compares
            </Link>
          </div>
          <p className="mt-4 text-sm text-[#666]">
            Free credits unlock when you connect a repository.
          </p>
        </div>
      </section>

      {/* What diff-only review misses */}
      <section className="relative z-10 px-4 pb-16 sm:px-8 md:px-12 md:pb-20">
        <div className="mx-auto max-w-4xl">
          <span className={kicker}>The gap</span>
          <h2 className={h2}>What diff-only review misses</h2>
          <p className="mt-4 max-w-2xl text-[#888]">
            Three changes that look fine inside the diff and break something
            outside it.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {misses.map((m) => (
              <div key={m.title} className={card}>
                <h3 className="text-base font-semibold text-white">{m.title}</h3>
                <div className="mt-4 space-y-2 text-xs">
                  <p className="rounded-lg border border-primary/50 bg-primary/10 px-3 py-2">
                    <span className="block text-[#888]">In the diff</span>
                    <span className="font-mono text-white">{m.inDiff}</span>
                  </p>
                  <p aria-hidden="true" className="text-center text-[#555]">↓ breaks</p>
                  <p className="rounded-lg border border-amber-400/60 bg-amber-400/10 px-3 py-2">
                    <span className="block text-[#888]">Not in the diff</span>
                    <span className="font-mono text-white">{m.outside}</span>
                  </p>
                </div>
                <p className="mt-4 text-sm text-[#a0a0a0]">{m.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What full-codebase review does instead */}
      <section className="relative z-10 px-4 pb-16 sm:px-8 md:px-12 md:pb-20">
        <div className="mx-auto max-w-4xl">
          <span className={kicker}>How it works</span>
          <h2 className={h2}>What full-codebase review does instead</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.name} className={card}>
                <p className="text-3xl font-bold text-primary">{i + 1}</p>
                <h3 className="mt-2 text-base font-semibold text-white">{s.name}</h3>
                <p className="mt-2 text-sm text-[#a0a0a0]">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* At a glance */}
      <section className="relative z-10 px-4 pb-16 sm:px-8 md:px-12 md:pb-20">
        <div className="mx-auto max-w-4xl">
          <span className={kicker}>At a glance</span>
          <h2 className={h2}>Diff-only vs full-codebase review</h2>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-white/[0.06] bg-[#161616]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-[#666]">
                  <th scope="col" className="px-5 py-4 font-medium"><span className="sr-only">Aspect</span></th>
                  <th scope="col" className="px-5 py-4 font-medium">Diff-only review</th>
                  <th scope="col" className="px-5 py-4 font-medium">Full-codebase review</th>
                </tr>
              </thead>
              <tbody>
                {glance.map(([label, diffOnly, full]) => (
                  <tr key={label} className="border-t border-white/[0.06]">
                    <th scope="row" className="px-5 py-4 font-semibold text-white">{label}</th>
                    <td className="px-5 py-4">{diffOnly}</td>
                    <td className="px-5 py-4">{full}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 max-w-2xl text-[#888]">
            Diff-only review is faster and cheaper. Even a one-line change
            can be worth a wider look if other code relies on it.
          </p>
        </div>
      </section>

      {/* Where the name came from */}
      <section className="relative z-10 px-4 pb-16 sm:px-8 md:px-12 md:pb-20">
        <div className={`mx-auto flex max-w-4xl flex-col items-center gap-8 md:flex-row ${card} md:p-10`}>
          <div className="relative h-[180px] w-[180px] shrink-0">
            <svg className="absolute inset-0 h-full w-full animate-[spin_25s_linear_infinite]" viewBox="0 0 400 400" aria-hidden="true">
              <defs>
                <path id="textCircle" d="M 200,200 m -165,0 a 165,165 0 1,1 330,0 a 165,165 0 1,1 -330,0" fill="none" />
              </defs>
              <text className="fill-white text-[1.9rem] font-bold uppercase tracking-[0.2em]" style={{ fontFamily: "var(--font-sans)" }}>
                <textPath href="#textCircle" textLength={2 * Math.PI * 165} lengthAdjust="spacing">
                  {" Not a Rabbit. Don’t follow trails • "}
                </textPath>
              </text>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Image src="/brand/octopus-mark.png" alt="Octopus" width={62} height={66} />
            </div>
          </div>
          <div>
            <span className={kicker}>The name</span>
            <h2 className={h2}>Where &ldquo;Not a Rabbit&rdquo; came from</h2>
            <p className="mt-4 text-[#999]">
              &ldquo;Not a Rabbit. Don&rsquo;t follow trails.&rdquo; started as
              an internal joke and ended up on a sticker we handed out at AWS
              Summit. A rabbit picks one trail and runs. An octopus wraps
              around the whole thing.{" "}
              <Link
                href="/blog/not-a-rabbit-don-t-follow-trails-the-story-behind-our-aws-summit-sticker"
                className="text-primary underline underline-offset-4"
              >
                Read the story behind the sticker
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Compare tools */}
      <section id="compare" className="relative z-10 scroll-mt-28 px-4 pb-16 sm:px-8 md:px-12 md:pb-20">
        <div className="mx-auto max-w-4xl">
          <span className={kicker}>Choosing a tool</span>
          <h2 className={h2}>Compare tools</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {compare.map((c) => (
              <Link key={c.href} href={c.href} className={`${card} block transition-colors hover:border-white/[0.16]`}>
                <h3 className="text-base font-semibold text-white">{c.title} →</h3>
                <p className="mt-2 text-sm text-[#a0a0a0]">{c.text}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Questions */}
      <section className="relative z-10 px-4 pb-20 sm:px-8 md:px-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-8 space-y-4">
            {faqs.map((f) => (
              <div key={f.q} className={card}>
                <h3 className="text-base font-semibold text-white">{f.q}</h3>
                <p className="mt-3 text-sm text-[#a0a0a0]">{f.a}</p>
              </div>
            ))}
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
            Octopus is source-available, free to self-host, and ready to review your
            next pull request.
          </p>
          <div className="mt-8">
            <SessionLink
              signedOutLabel="Try Octopus Free"
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition-all hover:bg-[#e0e0e0]"
            />
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
