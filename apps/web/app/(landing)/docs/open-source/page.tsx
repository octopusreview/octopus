import Link from "@/components/link";
import {
  IconHeartHandshake,
  IconBrandGithub,
  IconChecks,
  IconArrowRight,
  IconFileText,
  IconShieldCheck,
  IconRocket,
  IconBolt,
  IconInfoCircle,
} from "@tabler/icons-react";

export const metadata = {
  title: "Free for Open Source | Octopus Docs",
  description:
    "Octopus is free for public open source projects. Drop a single GitHub Actions step into your workflow and every pull request gets an AI code review — no credit card, no quota.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/open-source",
  },
};

const workflowYaml = `# .github/workflows/octopus.yml
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

export default function OpenSourcePage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#10D8BE]">
          <IconHeartHandshake className="size-4" />
          Free for Open Source
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Octopus is free for open source projects
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          Public repositories get unlimited AI code reviews on every pull
          request — no credit card, no monthly quota, no strings attached. We
          believe maintainers deserve great tooling.
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
              , commit it, and your next pull request will get an inline review
              from Octopus with severity-rated findings.
            </p>
          </div>
        </div>
      </div>

      {/* Quick start */}
      <Section title="Quick start">
        <Paragraph>
          The Octopus GitHub Action runs on every <Code>pull_request</Code>{" "}
          event, posts inline review comments, and exits cleanly when the
          review is done. You don&apos;t need to install anything else, sign up,
          or generate API keys — the action handles authentication via the
          ephemeral <Code>GITHUB_TOKEN</Code>.
        </Paragraph>

        <CodeBlock filename=".github/workflows/octopus.yml" code={workflowYaml} />

        <Paragraph>
          That&apos;s the whole setup. Open a pull request and Octopus will
          comment within a couple of minutes.
        </Paragraph>
      </Section>

      {/* What you get */}
      <Section title="What's included">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <FeatureRow
            icon={<IconChecks className="size-4" />}
            title="Unlimited PR reviews"
            description="Every opened or updated pull request gets a context-aware review. No monthly cap."
          />
          <FeatureRow
            icon={<IconRocket className="size-4" />}
            title="Codebase indexing"
            description="Your repo is indexed so reviews understand patterns and architecture, not just the diff."
          />
          <FeatureRow
            icon={<IconShieldCheck className="size-4" />}
            title="Security & bug detection"
            description="Critical, Major, Minor, Suggestion, and Tip severity levels on every finding."
          />
          <FeatureRow
            icon={<IconFileText className="size-4" />}
            title="No data retention"
            description="Source is processed in-memory. We never train on your code or persist diffs."
          />
        </div>
      </Section>

      {/* Eligibility */}
      <Section title="Who qualifies">
        <Paragraph>
          The free tier is for projects that are genuinely open source — public
          repositories with an OSI-approved license. Specifically:
        </Paragraph>
        <ul className="mb-4 space-y-2 text-sm text-[#888]">
          <EligibilityItem>
            The repository is <strong className="text-white">public</strong> on
            GitHub.
          </EligibilityItem>
          <EligibilityItem>
            It has an{" "}
            <a
              href="https://opensource.org/licenses"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
            >
              OSI-approved license
            </a>{" "}
            (MIT, Apache-2.0, GPL, BSD, MPL, etc.).
          </EligibilityItem>
          <EligibilityItem>
            It is not the public mirror of a commercial product gated behind a
            paid plan.
          </EligibilityItem>
        </ul>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-start gap-3">
            <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-[#888]" />
            <p className="text-sm text-[#888]">
              Working on a private repo or a commercial project? Check the{" "}
              <DocLink href="/docs/pricing">pricing page</DocLink> for credits
              and bring-your-own-key options.
            </p>
          </div>
        </div>
      </Section>

      {/* Tips */}
      <Section title="Tips for maintainers">
        <div className="mb-4 space-y-2">
          <TipRow
            title="Add an .octopusignore file"
            description="Skip generated code, fixtures, and vendored dependencies so reviews stay focused."
            href="/docs/octopusignore"
          />
          <TipRow
            title="Upload a knowledge base"
            description="Give Octopus your CONTRIBUTING.md or architecture notes for sharper, project-specific reviews."
            href="/docs/getting-started"
          />
          <TipRow
            title="Combine with the GitHub App"
            description="Prefer webhook-driven reviews instead of Actions? Install the GitHub App from the integrations page."
            href="/docs/integrations"
          />
        </div>
      </Section>

      {/* Footer CTAs */}
      <div className="mt-12 grid gap-3 sm:grid-cols-2">
        <CtaCard
          href="https://github.com/marketplace/actions/octopus-review"
          external
          icon={<IconBrandGithub className="size-4" />}
          title="View on GitHub Marketplace"
          description="Install the action from the marketplace listing."
        />
        <CtaCard
          href="/docs/getting-started"
          icon={<IconRocket className="size-4" />}
          title="Read the full setup guide"
          description="Step-by-step walkthrough for first-time users."
        />
      </div>
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
  return (
    <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-white">
      {children}
    </code>
  );
}

function CodeBlock({
  filename,
  code,
}: {
  filename?: string;
  code: string;
}) {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0a0a0a]">
      {filename && (
        <div className="border-b border-white/[0.06] px-4 py-2 text-xs text-[#666]">
          {filename}
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-3 text-xs leading-relaxed text-[#ddd]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function DocLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
    >
      {children}
    </Link>
  );
}

function FeatureRow({
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

function EligibilityItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <IconChecks className="mt-0.5 size-4 shrink-0 text-[#10D8BE]" />
      <span>{children}</span>
    </li>
  );
}

function TipRow({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
    >
      <div>
        <span className="text-sm font-medium text-white">{title}</span>
        <p className="mt-0.5 text-xs text-[#666]">{description}</p>
      </div>
      <IconArrowRight className="mt-1 size-4 shrink-0 text-[#333] transition-colors group-hover:text-white" />
    </Link>
  );
}

function CtaCard({
  href,
  external = false,
  icon,
  title,
  description,
}: {
  href: string;
  external?: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  const className =
    "group flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]";
  const content = (
    <>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[#888] transition-colors group-hover:text-white">
        {icon}
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-medium text-white">{title}</h4>
        <p className="mt-0.5 text-xs text-[#666]">{description}</p>
      </div>
      <IconArrowRight className="mt-1 size-4 shrink-0 text-[#333] transition-colors group-hover:text-white" />
    </>
  );
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
