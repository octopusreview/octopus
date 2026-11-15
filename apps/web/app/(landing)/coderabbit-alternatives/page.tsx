import type { Metadata } from "next";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";

const title = "CodeRabbit alternatives: 8 tools compared";
const description =
  "Eight CodeRabbit alternatives compared on git hosts, pricing, self-hosting and model keys, with figures read from each vendor's own site.";
const url = "https://octopus-review.ai/coderabbit-alternatives";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, url, type: "website" },
  alternates: { canonical: url },
};

const TABLE_HEAD = ["Tool", "Git hosts", "Pricing, with published figures", "Self-hosting", "Own model key"];

const TABLE_ROWS: string[][] = [
  [
    "Octopus",
    "GitHub, GitLab, Bitbucket, Forgejo",
    "Usage credits, no seat fee. Cloud bills AI usage at 2x the provider's list price. Free credits on signup",
    "Yes, with Docker Compose",
    "Yes",
  ],
  [
    "Greptile",
    "GitHub Cloud, GitLab.com, Bitbucket Cloud, Cursor Origin (beta). Self-managed hosts on Enterprise",
    "Credits, no seat fees. Starter: free, 1 active developer, 50 credits a month. Pro: $1 per credit. A review costs 1, 3 or 10 credits",
    "Enterprise",
    "Self-hosted only. Cloud: not published",
  ],
  [
    "Qodo",
    "GitHub, GitLab, Bitbucket, Azure DevOps. Gerrit on Enterprise",
    "Pro Team: pooled credits at $0.015 each. Qodo's blog says packs start at $30 a month for 2,000 credits, about 14 reviews. No permanent free tier",
    "Enterprise only",
    "Enterprise only",
  ],
  [
    "GitHub Copilot code review",
    "GitHub.com. Azure DevOps in public preview",
    "Copilot plan from $10 per user per month (Pro). Reviews use AI credits at $0.01 each. GitHub estimates about $0.25 to $10 a review, before Actions minutes",
    "Not published",
    "Not published",
  ],
  [
    "Cursor Bugbot",
    "GitHub, GitLab, Bitbucket, Azure DevOps Services",
    "Usage within a Cursor plan, from Premium at $30 a month. Cursor says the average review costs $1.00 to $1.50",
    "Not published",
    "Not published",
  ],
  [
    "Graphite",
    "GitHub. GitHub Enterprise Server on Enterprise",
    "Per user per month, billed annually: Hobby free, Starter $20, Team $40. Monthly prices: not published",
    "Not published",
    "Not published",
  ],
  [
    "Kodus",
    "GitHub, GitLab, Bitbucket, Azure DevOps, Forgejo/Gitea",
    "Community: free with your own key. Teams: $10 per developer per month plus tokens, or $8 billed annually",
    "Yes, on Community and Enterprise",
    "Yes, on every plan",
  ],
  [
    "Sourcery",
    "GitHub, GitLab.com, self-managed GitLab",
    "Per seat per month. Pro: $12 billed annually or $15 monthly. Team: $24 or $30. Free for public repositories",
    "Enterprise only",
    "Enterprise, per the pricing page",
  ],
];

const SOURCES: Array<[name: string, href: string]> = [
  ["CodeRabbit", "https://www.coderabbit.ai/pricing"],
  ["Greptile", "https://www.greptile.com/pricing"],
  ["Qodo", "https://www.qodo.ai/pricing/"],
  ["GitHub Copilot", "https://docs.github.com/en/copilot/concepts/agents/code-review"],
  ["Cursor Bugbot", "https://cursor.com/bugbot"],
  ["Graphite", "https://graphite.com/pricing"],
  ["Kodus", "https://kodus.io/en/pricing/"],
  ["Sourcery", "https://sourcery.ai/pricing"],
];

const TOOLS: Array<[name: string, text: string]> = [
  [
    "Octopus",
    `Octopus is ours, so weigh this entry accordingly. It is a source-available AI code reviewer under a Modified MIT licence that indexes the whole repository, and you choose the review model per organisation or per repository. It suits teams that want to pick their model and pay per review. It does not support Azure DevOps, and it has no fixed per-seat price.`,
  ],
  [
    "Greptile",
    `Greptile describes itself as an AI code review agent that reviews every pull request "with complete understanding of your codebase". That context is its stated strength. It suits teams that prefer credits to seats.`,
  ],
  [
    "Qodo",
    `Qodo calls itself "an AI code review and governance platform for engineering teams". It says it holds the highest F1-score on the AI code review benchmark. Its Pro Team plan is designed for up to 30 users.`,
  ],
  [
    "GitHub Copilot code review",
    `GitHub says: "Copilot reviews your pull requests, identifies issues, and suggests fixes you can apply in a couple of clicks." It is built into the GitHub pull request, so it suits teams that already pay for Copilot. You choose an effort level, not a model.`,
  ],
  [
    "Cursor Bugbot",
    `Cursor describes Bugbot as "AI code review that catches real bugs" and says 70% or more of its flags are resolved before merge. It suits teams on a Cursor plan that includes it.`,
  ],
  [
    "Graphite",
    `Graphite calls itself "the AI code review platform where teams ship higher quality code, faster". It pairs AI review with stacked pull requests and a merge queue, which suits GitHub teams that work that way. On 19 December 2025, Cursor's blog announced an agreement to acquire Graphite.`,
  ],
  [
    "Kodus",
    `Kodus describes itself as "Open source AI code review you can self-host, with the LLM you choose". Its core is under AGPL-3.0, with enterprise files under a separate Kodus licence. It suits teams that need an open-source licence.`,
  ],
  [
    "Sourcery",
    `Sourcery's tagline is "Perfectionist AI code review". It is free for public repositories and supports GitLab on every plan. It suits teams that want a fixed price per seat.`,
  ],
];

const HOW_TO_CHOOSE = [
  "If you want to self-host or use your own provider key without an enterprise plan, look at Octopus or Kodus.",
  "If you need an open-source licence, look at Kodus.",
  "If your code is on Azure DevOps, look at Qodo, Cursor Bugbot or Kodus.",
  "If you already pay for Copilot or Cursor, try the reviewer in your plan first.",
  "If you use stacked pull requests, look at Graphite.",
  "If you want a fixed price per seat, look at Sourcery or Graphite.",
  "If you want usage pricing with no seat fee, look at Octopus or Greptile.",
  "If none of these applies, CodeRabbit may already be the right tool.",
];

const h2Class = "text-2xl font-bold tracking-tight text-white sm:text-3xl";

export default function CodeRabbitAlternativesPage() {
  return (
    <div className="dark relative min-h-screen bg-background text-[#a0a0a0] selection:bg-white/20">
      <LandingMobileNav />
      <LandingDesktopNav />

      <section className="relative z-10 px-6 pt-32 pb-16 md:px-8 md:pt-40 md:pb-20">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            CodeRabbit alternatives: eight AI code review tools compared
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-[#888]">
            Teams usually look for a CodeRabbit alternative for one of four
            reasons: pricing model, git host, self-hosting, or choice of model.
            CodeRabbit charges per developer per month, from $24 billed annually
            on paid plans, and covers GitHub, GitLab, Bitbucket and Azure
            DevOps. That fits many teams. For the rest, here are eight other
            tools and what each vendor&apos;s own site says it does well.
          </p>
        </div>
      </section>

      <section className="relative z-10 px-4 pb-16 sm:px-8 md:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 id="comparison-table" className={h2Class}>
            Comparison table
          </h2>
          <div className="mt-8 overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616]">
            {/* The table scrolls sideways in here, so a phone never scrolls the whole page. */}
            <div role="region" aria-labelledby="comparison-table" tabIndex={0} className="overflow-x-auto">
              <table className="w-full min-w-[60rem] text-left">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {TABLE_HEAD.map((heading) => (
                      <th key={heading} scope="col" className="px-6 py-5 text-sm font-semibold text-white">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TABLE_ROWS.map(([tool, ...cells]) => (
                    <tr key={tool} className="border-b border-white/[0.04] last:border-0">
                      <th scope="row" className="px-6 py-4 align-top text-sm font-semibold text-white">
                        {tool}
                      </th>
                      {cells.map((cell, index) => (
                        <td key={index} className="px-6 py-4 align-top text-sm text-[#cfcfcf]">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-6 text-sm text-[#a0a0a0]">
            Prices and features were read from each vendor&apos;s own site on 14
            November 2026 and may have changed.
          </p>
          <p className="mt-6 text-sm text-[#a0a0a0]">Sources:</p>
          <ul className="mt-3 list-outside list-disc space-y-2 pl-5 text-sm text-[#a0a0a0]">
            {SOURCES.map(([name, href]) => (
              <li key={name}>
                {name}:{" "}
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white underline decoration-white/30 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-white"
                >
                  {href}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative z-10 px-4 pb-16 sm:px-8 md:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 className={h2Class}>The eight tools</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {TOOLS.map(([name, text]) => (
              <div key={name} className="rounded-2xl border border-white/[0.06] bg-[#161616] p-6">
                <h3 className="text-base font-semibold text-white">{name}</h3>
                <p className="mt-3 text-sm text-[#a0a0a0]">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 px-4 pb-24 sm:px-8 md:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 className={h2Class}>How to choose</h2>
          <ul className="mt-8 list-outside list-disc space-y-3 rounded-2xl border border-white/[0.06] bg-[#161616] p-8 pl-12 text-sm text-[#a0a0a0]">
            {HOW_TO_CHOOSE.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
