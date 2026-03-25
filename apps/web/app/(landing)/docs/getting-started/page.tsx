import Link from "next/link";
import {
  IconRocket,
  IconBrandGithub,
  IconBrandBitbucket,
  IconGitPullRequest,
  IconAlertTriangle,
  IconAlertCircle,
  IconInfoCircle,
  IconBulb,
  IconCircleDot,
  IconTerminal2,
  IconSettings,
  IconArrowRight,
  IconPlugConnected,
  IconServer,
  IconWand,
  IconBrain,
} from "@tabler/icons-react";

export const metadata = {
  title: "Getting Started | Octopus Docs",
  description:
    "Get started with Octopus. Connect your repo, get your first AI-powered code review, and learn how to get the most out of automated reviews.",
};

export default function GettingStartedPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconRocket className="size-4" />
          Getting Started
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Get Started with Octopus
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          AI-powered code reviews that understand your codebase. Connect your
          repo and get your first review in minutes.
        </p>
      </div>

      {/* What is Octopus */}
      <Section title="What is Octopus?">
        <Paragraph>
          Octopus is an AI-powered code review tool that indexes your entire
          codebase, learns your patterns and architecture, and reviews every pull
          request with deep context awareness. It catches real bugs, security
          issues, and code quality problems before they reach production.
        </Paragraph>
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <FeatureCard
            icon={<IconBrain className="size-4" />}
            title="Codebase-Aware"
            description="Indexes your code and understands your architecture, not just the diff."
          />
          <FeatureCard
            icon={<IconGitPullRequest className="size-4" />}
            title="Automatic Reviews"
            description="Every PR gets reviewed instantly with severity-rated inline comments."
          />
          <FeatureCard
            icon={<IconPlugConnected className="size-4" />}
            title="Works With Your Tools"
            description="GitHub, Bitbucket, Slack, Linear. Fits into your existing workflow."
          />
        </div>
      </Section>

      {/* Step 1: Connect */}
      <Section title="1. Connect Your Repository">
        <Paragraph>
          Start by connecting your GitHub or Bitbucket account from the
          dashboard. Octopus will install as a GitHub App or set up Bitbucket
          OAuth to receive webhook events from your repositories.
        </Paragraph>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <ProviderCard
            icon={<IconBrandGithub className="size-5" />}
            name="GitHub"
            description="Install the GitHub App, select repositories, and you're ready to go."
          />
          <ProviderCard
            icon={<IconBrandBitbucket className="size-5" />}
            name="Bitbucket"
            description="Connect via OAuth and Octopus automatically manages webhooks."
          />
        </div>
        <Paragraph>
          Once connected, Octopus indexes your codebase. It chunks your code,
          creates embeddings, and builds a searchable representation of your
          entire project. This is what makes reviews context-aware.
        </Paragraph>
      </Section>

      {/* Step 2: First review */}
      <Section title="2. Your First Review">
        <Paragraph>
          Open a pull request on any connected repository. Octopus automatically
          picks it up via webhook, analyzes the diff against your full codebase,
          and posts its findings as inline review comments within minutes.
        </Paragraph>
        <div className="mb-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <h4 className="mb-3 text-sm font-medium text-white">
            What happens behind the scenes
          </h4>
          <ol className="space-y-2 text-sm text-[#888]">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[10px] font-bold text-white">
                1
              </span>
              <span>
                Webhook event arrives from GitHub/Bitbucket
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[10px] font-bold text-white">
                2
              </span>
              <span>
                Octopus fetches the diff and searches your indexed codebase for
                relevant context
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[10px] font-bold text-white">
                3
              </span>
              <span>
                AI reviews the changes with full codebase context and your
                organization&apos;s knowledge base
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[10px] font-bold text-white">
                4
              </span>
              <span>
                Findings are posted as inline comments on the PR with severity
                levels
              </span>
            </li>
          </ol>
        </div>
      </Section>

      {/* Step 3: Severity levels */}
      <Section title="3. Understanding Findings">
        <Paragraph>
          Every finding includes a severity level so you can prioritize what
          matters most. Critical issues block the PR with a
          REQUEST_CHANGES review, while suggestions are informational.
        </Paragraph>
        <div className="mb-4 space-y-2">
          <SeverityRow
            icon={<IconCircleDot className="size-4" />}
            color="text-red-400"
            label="Critical"
            description="Bugs, security vulnerabilities, data loss risks. Blocks merge."
          />
          <SeverityRow
            icon={<IconAlertTriangle className="size-4" />}
            color="text-orange-400"
            label="Warning"
            description="Logic errors, performance issues, potential edge cases."
          />
          <SeverityRow
            icon={<IconAlertCircle className="size-4" />}
            color="text-yellow-400"
            label="Caution"
            description="Code quality, maintainability, and best practice concerns."
          />
          <SeverityRow
            icon={<IconInfoCircle className="size-4" />}
            color="text-blue-400"
            label="Info"
            description="Informational notes about the code, documentation, or conventions."
          />
          <SeverityRow
            icon={<IconBulb className="size-4" />}
            color="text-purple-400"
            label="Suggestion"
            description="Optional improvements, alternative approaches, and ideas."
          />
        </div>
      </Section>

      {/* Step 4: CLI */}
      <Section title="4. Use the CLI as an AI-Powered Dev Tool">
        <Paragraph>
          The Octopus CLI is more than a command-line interface. It gives AI
          coding tools like Claude Code, Cursor, and Copilot direct access to
          your codebase context. Use it to review PRs, index repos, chat with
          your code, and manage your knowledge base from the terminal or from
          inside any AI-powered editor.
        </Paragraph>
        <div className="mb-4 space-y-2">
          <CommandRow
            command="octopus repo chat"
            description="Start an interactive chat session about your codebase. Ask questions, explore architecture."
          />
          <CommandRow
            command="octopus pr review 42"
            description="Trigger an AI review on any pull request by number or URL."
          />
          <CommandRow
            command="octopus repo index"
            description="Index your repository for code search and review context."
          />
          <CommandRow
            command="octopus knowledge add docs/api.md"
            description="Add custom documents to your org's knowledge base for richer reviews."
          />
        </div>
        <Paragraph>
          You can also run a <strong className="text-white">local agent</strong> on
          your machine to supercharge Octopus Chat with real-time code search.
          The agent searches your actual source code when someone asks a question
          in chat — giving much more precise answers than embeddings alone.
        </Paragraph>
        <div className="mb-4 space-y-2">
          <CommandRow
            command="octopus agent watch"
            description="Add the current repo to the agent's watch list. Detects the repo from the git remote URL."
          />
          <CommandRow
            command="octopus agent start"
            description="Start the local agent. Listens for search requests from Octopus Chat and responds with real-time code results."
          />
        </div>
        <Paragraph>
          Install with{" "}
          <Code>npm install -g @octp/cli</Code> and run{" "}
          <Code>octopus login</Code> to get started. See the full{" "}
          <DocLink href="/docs/cli">CLI reference</DocLink> for all commands.
        </Paragraph>
      </Section>

      {/* Step 5: Customize */}
      <Section title="5. Customize Your Setup">
        <Paragraph>
          Fine-tune how Octopus works for your team from the organization
          settings page.
        </Paragraph>
        <div className="mb-4 space-y-2">
          <SettingRow
            title="AI Provider"
            description="Choose between Claude and OpenAI, or bring your own API keys."
          />
          <SettingRow
            title="Knowledge Base"
            description="Upload architecture docs, coding guidelines, and API references so reviews understand your conventions."
          />
          <SettingRow
            title=".octopusignore"
            description="Exclude generated files, test fixtures, and vendor code from reviews and indexing."
          />
          <SettingRow
            title="Spend Limits"
            description="Set monthly token budgets and monitor usage per repository."
          />
          <SettingRow
            title="Notifications"
            description="Configure Slack notifications for review completions, indexing, and more."
          />
        </div>
      </Section>

      {/* Next steps */}
      <Section title="Next Steps">
        <div className="grid gap-3 sm:grid-cols-2">
          <NextStepCard
            href="/docs/integrations"
            icon={<IconPlugConnected className="size-4" />}
            title="Integrations"
            description="Connect GitHub, Bitbucket, Slack, and Linear"
          />
          <NextStepCard
            href="/docs/cli"
            icon={<IconTerminal2 className="size-4" />}
            title="CLI Reference"
            description="All commands and configuration options"
          />
          <NextStepCard
            href="/docs/self-hosting"
            icon={<IconServer className="size-4" />}
            title="Self-Hosting"
            description="Deploy Octopus on your own infrastructure"
          />
          <NextStepCard
            href="/docs/skills"
            icon={<IconWand className="size-4" />}
            title="Skills"
            description="AI-powered automation workflows"
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
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#888]">
        {icon}
      </div>
      <h4 className="text-sm font-medium text-white">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-[#666]">{description}</p>
    </div>
  );
}

function ProviderCard({
  icon,
  name,
  description,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[#888]">
        {icon}
      </div>
      <div>
        <h4 className="text-sm font-medium text-white">{name}</h4>
        <p className="mt-0.5 text-xs leading-relaxed text-[#666]">
          {description}
        </p>
      </div>
    </div>
  );
}

function SeverityRow({
  icon,
  color,
  label,
  description,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className={`mt-0.5 shrink-0 ${color}`}>{icon}</div>
      <div>
        <span className={`text-sm font-medium ${color}`}>{label}</span>
        <p className="mt-0.5 text-xs text-[#666]">{description}</p>
      </div>
    </div>
  );
}

function CommandRow({
  command,
  description,
}: {
  command: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <code className="text-sm font-medium text-white">{command}</code>
      <p className="mt-1 text-xs text-[#666]">{description}</p>
    </div>
  );
}

function SettingRow({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <IconSettings className="mt-0.5 size-4 shrink-0 text-[#555]" />
      <div>
        <span className="text-sm font-medium text-white">{title}</span>
        <p className="mt-0.5 text-xs text-[#666]">{description}</p>
      </div>
    </div>
  );
}

function NextStepCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[#888] transition-colors group-hover:text-white">
        {icon}
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-medium text-white">{title}</h4>
        <p className="mt-0.5 text-xs text-[#666]">{description}</p>
      </div>
      <IconArrowRight className="mt-1 size-4 shrink-0 text-[#333] transition-colors group-hover:text-white" />
    </Link>
  );
}
