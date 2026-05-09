import Link from "next/link";
import {
  IconBrandGithub,
  IconKey,
  IconBolt,
  IconShieldCheck,
  IconBook2,
  IconAdjustmentsAlt,
  IconHistory,
  IconArrowRight,
} from "@tabler/icons-react";
import { CodeBlock } from "../self-hosting/code-block";

export const metadata = {
  title: "GitHub Action | Octopus Docs",
  description:
    "Install the Octopus GitHub Action to get AI-powered code reviews on every pull request. Free for public repos. Add octopus-api-key to unlock your team's knowledge base, custom rules, and full review history.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/github-action",
  },
};

const minimalYaml = `# .github/workflows/octopus.yml
name: Octopus Review
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: octopusreview/action@v1
`;

const apiKeyYaml = `name: Octopus Review
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: octopusreview/action@v1
        with:
          octopus-api-key: \${{ secrets.OCTOPUS_API_KEY }}
`;

const outputsYaml = `steps:
  - uses: octopusreview/action@v1
    id: review
    with:
      octopus-api-key: \${{ secrets.OCTOPUS_API_KEY }}

  - if: steps.review.outputs.findings-count != '0'
    run: echo "Octopus found \${{ steps.review.outputs.findings-count }} issues"
`;

const pathsYaml = `on:
  pull_request:
    types: [opened, synchronize]
    paths:
      - "src/**"
      - "lib/**"
`;

export default function GitHubActionPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconBrandGithub className="size-4" />
          GitHub Action
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Octopus GitHub Action
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          AI-powered, context-aware code review for every pull request. Free
          for open source. Add an API key to unlock your team&apos;s knowledge
          base, custom rules, and full review history.
        </p>
      </div>

      {/* Highlight banner */}
      <div className="mb-10 rounded-2xl border border-[#10D8BE]/25 bg-[#10D8BE]/[0.04] p-6">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#10D8BE]/10 text-[#10D8BE]">
            <IconBolt className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              One workflow file. Reviews on every PR.
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[#aaa]">
              Drop the YAML below into{" "}
              <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-white">
                .github/workflows/octopus.yml
              </code>
              , commit it, and your next pull request gets an inline review
              from Octopus with severity-rated findings.
            </p>
          </div>
        </div>
      </div>

      {/* Quick start */}
      <Section title="Quick Start">
        <Paragraph>
          For public repositories, no signup or API key is required. The action
          runs in <strong className="text-white">community mode</strong> by
          default, with up to 5 reviews per repository per day.
        </Paragraph>
        <CodeBlock title=".github/workflows/octopus.yml">{minimalYaml}</CodeBlock>
        <Paragraph>
          That&apos;s it. Open a pull request, and Octopus will index the repo
          on the first run, then post inline review comments with severity
          levels and suggested fixes.
        </Paragraph>
      </Section>

      {/* Private repos / API key */}
      <Section title="Private Repos &amp; Full Access">
        <Paragraph>
          Private repositories require an Octopus API key. Adding a key also
          unlocks the full feature set on public repos: your team&apos;s
          knowledge base, custom rules, full review history, and unlimited
          reviews within your plan.
        </Paragraph>
        <ol className="mb-3 list-inside list-decimal space-y-1.5 text-sm text-[#888]">
          <li>
            Sign up at{" "}
            <Link
              href="/login"
              className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
            >
              octopus-review.ai
            </Link>
          </li>
          <li>
            Go to <Mono>Settings &gt; API Keys</Mono> and create a key (it
            starts with <Mono>oct_</Mono>)
          </li>
          <li>
            Add it to your repository as a secret named{" "}
            <Mono>OCTOPUS_API_KEY</Mono>
          </li>
        </ol>
        <CodeBlock title=".github/workflows/octopus.yml">{apiKeyYaml}</CodeBlock>
      </Section>

      {/* Community vs Full */}
      <Section title="Community vs API Key">
        <div className="overflow-hidden rounded-lg border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02] text-left text-xs uppercase tracking-wider text-[#666]">
                <th className="px-4 py-2 font-medium">Feature</th>
                <th className="px-4 py-2 font-medium">Community</th>
                <th className="px-4 py-2 font-medium">With API Key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-[#aaa]">
              <Row feature="AI code review" community="Yes" full="Yes" />
              <Row feature="Codebase indexing" community="Yes" full="Yes" />
              <Row
                feature="Daily limit"
                community="5 per repo / day"
                full="Unlimited (plan-based)"
              />
              <Row
                feature="Private repos"
                community={<span className="text-[#666]">Not supported</span>}
                full="Supported"
              />
              <Row
                feature="Knowledge base"
                community={<span className="text-[#555]">Not included</span>}
                full="Custom docs &amp; rules"
              />
              <Row
                feature="Custom config"
                community={<span className="text-[#555]">Not included</span>}
                full="Severity, categories, paths"
              />
              <Row
                feature="Review history"
                community={<span className="text-[#555]">Not included</span>}
                full="Full history &amp; analytics"
              />
              <Row
                feature="Feedback learning"
                community={<span className="text-[#555]">Not included</span>}
                full="Team-wide suppression"
              />
            </tbody>
          </table>
        </div>
      </Section>

      {/* Why add an API key */}
      <Section title="What an API Key Unlocks">
        <FeatureGrid>
          <Feature
            icon={<IconBook2 className="size-4" />}
            title="Knowledge Base"
            description="Upload internal docs, style guides, and architecture notes. Reviews cite them directly."
          />
          <Feature
            icon={<IconAdjustmentsAlt className="size-4" />}
            title="Custom Rules"
            description="Configure severity thresholds, disable categories, and tune the reviewer to match your team."
          />
          <Feature
            icon={<IconHistory className="size-4" />}
            title="Full Review History"
            description="Browse past reviews, track findings over time, and analyze trends across PRs."
          />
          <Feature
            icon={<IconShieldCheck className="size-4" />}
            title="Feedback Learning"
            description="Thumbs-down a finding once and the reviewer suppresses it team-wide."
          />
        </FeatureGrid>
        <div className="mt-2">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.04] px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/[0.08]"
          >
            <IconKey className="size-4" />
            Get your API key
            <IconArrowRight className="size-3.5" />
          </Link>
        </div>
      </Section>

      {/* Inputs */}
      <Section title="Inputs">
        <div className="mb-4 overflow-hidden rounded-lg border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02] text-left text-xs uppercase tracking-wider text-[#666]">
                <th className="px-4 py-2 font-medium">Input</th>
                <th className="px-4 py-2 font-medium">Required</th>
                <th className="px-4 py-2 font-medium">Default</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-[#aaa]">
              <InputRow
                name="octopus-api-key"
                required="No"
                defaultValue="(none)"
                description="Octopus API key (oct_*). Required for private repos. Optional for public repos (free community tier)."
              />
              <InputRow
                name="github-token"
                required="No"
                defaultValue="${{ github.token }}"
                description="GitHub token used to fetch the diff and post review comments. The default token is auto-provided by Actions."
              />
              <InputRow
                name="api-url"
                required="No"
                defaultValue="https://octopus-review.ai"
                description="Base URL of the Octopus API. Override this if you self-host."
              />
              <InputRow
                name="force-reindex"
                required="No"
                defaultValue="false"
                description="Force re-index the repository before reviewing, even if a recent index exists."
              />
              <InputRow
                name="reindex-threshold-hours"
                required="No"
                defaultValue="24"
                description="Re-index if the last index is older than this many hours."
              />
            </tbody>
          </table>
        </div>
      </Section>

      {/* Outputs */}
      <Section title="Outputs">
        <div className="mb-4 overflow-hidden rounded-lg border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02] text-left text-xs uppercase tracking-wider text-[#666]">
                <th className="px-4 py-2 font-medium">Output</th>
                <th className="px-4 py-2 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-[#aaa]">
              <tr>
                <td className="px-4 py-2.5 align-top">
                  <code className="text-xs text-white">findings-count</code>
                </td>
                <td className="px-4 py-2.5 text-[#888]">
                  Total number of findings in the review.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 align-top">
                  <code className="text-xs text-white">summary</code>
                </td>
                <td className="px-4 py-2.5 text-[#888]">
                  Review summary text.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Permissions */}
      <Section title="Permissions">
        <Paragraph>
          The action needs these GitHub token permissions:
        </Paragraph>
        <div className="mb-3 space-y-1.5">
          <PermItem
            perm="contents: read"
            description="Fetch the PR diff and index the repository."
          />
          <PermItem
            perm="pull-requests: write"
            description="Post review comments and summary."
          />
        </div>
        <Paragraph>
          For private repos, the default <Mono>GITHUB_TOKEN</Mono> already has
          access to the repository it runs in. The token is passed to Octopus
          for indexing only, is never stored, and expires when the workflow
          ends.
        </Paragraph>
      </Section>

      {/* Examples */}
      <Section title="Examples">
        <h3 className="mb-2 mt-2 text-sm font-semibold text-[#ccc]">
          Restrict reviews to specific paths
        </h3>
        <CodeBlock>{pathsYaml}</CodeBlock>

        <h3 className="mb-2 mt-4 text-sm font-semibold text-[#ccc]">
          Use outputs in subsequent steps
        </h3>
        <CodeBlock>{outputsYaml}</CodeBlock>
      </Section>

      {/* How it works */}
      <Section title="How It Works">
        <ol className="mb-3 list-inside list-decimal space-y-1.5 text-sm text-[#888]">
          <li>A pull request is opened or updated.</li>
          <li>The action fetches the PR diff (capped at 500KB).</li>
          <li>
            Octopus indexes your repo on the first run, then caches the index
            for the configured threshold.
          </li>
          <li>
            The diff is reviewed with full codebase context, not just the
            changed lines.
          </li>
          <li>
            Findings are posted as inline PR review comments with severity
            levels and suggested fixes.
          </li>
        </ol>
      </Section>

      {/* FAQ */}
      <Section title="FAQ">
        <Faq question="Does Octopus store my code?">
          No. Source code is used temporarily for indexing (creating vector
          embeddings) and reviewing. Source code is never stored. Embeddings
          are cached to speed up subsequent reviews.
        </Faq>
        <Faq question="How does the community tier work?">
          Public repositories can use Octopus with no signup. A community
          organization is created automatically per GitHub owner (user or
          org). The default daily limit is 5 reviews per repository.
        </Faq>
        <Faq question="What models does Octopus use?">
          Claude (Anthropic) for code review and OpenAI for embeddings by
          default. Organizations with API keys can configure custom models.
        </Faq>
        <Faq question="Can I configure what gets reviewed?">
          With an API key you can customize severity thresholds, disable
          specific finding categories, and add knowledge documents that guide
          the reviewer. See the{" "}
          <Link
            href="/docs/octopusignore"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            .octopusignore reference
          </Link>{" "}
          to exclude files from review and indexing.
        </Faq>
        <Faq question="Where is the action source code?">
          The action is open source at{" "}
          <a
            href="https://github.com/octopusreview/action"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            github.com/octopusreview/action
          </a>
          .
        </Faq>
      </Section>

      {/* Related */}
      <Section title="Related">
        <div className="grid gap-2 sm:grid-cols-2">
          <RelatedLink
            href="/docs/open-source"
            title="Free for Open Source"
            description="Why Octopus is free for public repos."
          />
          <RelatedLink
            href="/docs/integrations"
            title="Integrations"
            description="GitHub, Bitbucket, Slack, Linear."
          />
          <RelatedLink
            href="/docs/cli"
            title="CLI"
            description="Run reviews and index repos from the terminal."
          />
          <RelatedLink
            href="/docs/octopusignore"
            title=".octopusignore"
            description="Exclude files from indexing and review."
          />
        </div>
      </Section>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-[#ccc]">
      {children}
    </code>
  );
}

function FeatureGrid({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#888]">
        {icon}
      </div>
      <h4 className="text-sm font-medium text-white">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-[#666]">{description}</p>
    </div>
  );
}

function Row({
  feature,
  community,
  full,
}: {
  feature: string;
  community: React.ReactNode;
  full: React.ReactNode;
}) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-[#ccc]">{feature}</td>
      <td className="px-4 py-2.5">{community}</td>
      <td className="px-4 py-2.5">{full}</td>
    </tr>
  );
}

function InputRow({
  name,
  required,
  defaultValue,
  description,
}: {
  name: string;
  required: string;
  defaultValue: string;
  description: string;
}) {
  return (
    <>
      <tr>
        <td className="px-4 pb-1 pt-2.5 align-top">
          <code className="text-xs text-white">{name}</code>
        </td>
        <td className="px-4 pb-1 pt-2.5 text-[#888]">{required}</td>
        <td className="px-4 pb-1 pt-2.5">
          <code className="text-xs text-[#ccc]">{defaultValue}</code>
        </td>
      </tr>
      <tr>
        <td colSpan={3} className="px-4 pb-2.5 text-xs leading-relaxed text-[#666]">
          {description}
        </td>
      </tr>
    </>
  );
}

function PermItem({
  perm,
  description,
}: {
  perm: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
      <code className="text-sm font-medium text-white">{perm}</code>
      <p className="mt-1 text-xs text-[#666]">{description}</p>
    </div>
  );
}

function Faq({
  question,
  children,
}: {
  question: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 text-sm font-medium text-white">{question}</h3>
      <p className="text-sm leading-relaxed text-[#888]">{children}</p>
    </div>
  );
}

function RelatedLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.04]"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">{title}</span>
        <IconArrowRight className="size-3.5 text-[#666] transition-colors group-hover:text-white" />
      </div>
      <p className="mt-1 text-xs text-[#666]">{description}</p>
    </Link>
  );
}
