import Link from "next/link";
import { IconBrandGithub, IconTerminal2, IconWand, IconRobot, IconMessageCircle } from "@tabler/icons-react";
import { CodeBlock } from "../../self-hosting/code-block";

export const metadata = {
  title: "Claude Code Integration — Octopus Docs",
  description:
    "Use the Octopus plugin for Claude Code to review PRs, auto-fix findings, and chat with your codebase without leaving the terminal.",
};

export default function ClaudeCodeIntegrationPage() {
  return (
    <article className="prose-invert max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconTerminal2 className="size-4" />
          CLI / Claude Code
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Claude Code Integration
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          Bring Octopus code reviews directly into Claude Code. Review PRs,
          auto-fix findings, and explore your codebase without leaving the
          terminal.
        </p>
      </div>

      {/* Overview */}
      <Section title="Overview">
        <Paragraph>
          The Octopus plugin for Claude Code adds AI-powered code review as a
          native capability. It wraps the{" "}
          <Link
            href="/docs/cli"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            Octopus CLI
          </Link>{" "}
          so you can trigger reviews, fix findings, and interact with your
          codebase using natural language or slash commands.
        </Paragraph>

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <FeatureCard
            icon={<IconWand className="size-5" />}
            title="Slash Commands"
            description="Type /review to trigger a PR review instantly."
          />
          <FeatureCard
            icon={<IconMessageCircle className="size-5" />}
            title="Natural Language"
            description={`Say "review my code" or "find security issues" and the plugin activates.`}
          />
          <FeatureCard
            icon={<IconRobot className="size-5" />}
            title="Autofix"
            description="Scan open PRs for Octopus review comments, apply fixes, and push updates."
          />
        </div>
      </Section>

      {/* Prerequisites */}
      <Section title="Prerequisites">
        <Paragraph>
          You need the Octopus CLI installed and authenticated before using the
          plugin.
        </Paragraph>

        <h3 className="mb-2 mt-4 text-sm font-semibold text-white">
          1. Install the CLI
        </h3>
        <CodeBlock>{`# macOS / Linux (x64 & ARM)
curl -fsSL https://octopus-review.ai/install.sh | sh

# Windows (PowerShell)
irm https://octopus-review.ai/install.ps1 | iex

# Windows ARM
npm install -g @octp/cli`}</CodeBlock>

        <h3 className="mb-2 mt-4 text-sm font-semibold text-white">
          2. Authenticate
        </h3>
        <CodeBlock>{`octopus login

# Or with a token
octopus login --token oct_your_token_here`}</CodeBlock>

        <h3 className="mb-2 mt-4 text-sm font-semibold text-white">
          3. Verify
        </h3>
        <CodeBlock>octopus whoami</CodeBlock>
      </Section>

      {/* Install Plugin */}
      <Section title="Install the Plugin">
        <Paragraph>
          Install from the Claude Code Plugin Marketplace:
        </Paragraph>
        <CodeBlock>claude plugin install octopus</CodeBlock>
        <Paragraph>Or from within a Claude Code session:</Paragraph>
        <CodeBlock>/plugin install octopus</CodeBlock>
      </Section>

      {/* Review Command */}
      <Section title="Review a Pull Request">
        <Paragraph>
          Use the <Mono>/review</Mono> slash command to trigger a review
          on a pull request.
        </Paragraph>
        <CodeBlock>{`# Review current branch's PR (auto-detected)
/review

# Review by PR number
/review 42

# Review by URL
/review https://github.com/owner/repo/pull/42`}</CodeBlock>
        <Paragraph>
          The review runs asynchronously. Once complete, findings appear as
          comments directly on the PR with severity levels:
        </Paragraph>

        <div className="mb-4 space-y-1.5">
          {[
            { severity: "Critical", color: "text-red-400", desc: "Security vulnerabilities, data loss risks" },
            { severity: "High", color: "text-orange-400", desc: "Bugs, logic errors, performance issues" },
            { severity: "Medium", color: "text-yellow-400", desc: "Code quality, maintainability concerns" },
            { severity: "Low", color: "text-blue-400", desc: "Style, naming, minor improvements" },
            { severity: "Info", color: "text-purple-400", desc: "Suggestions, best practices, tips" },
          ].map((item) => (
            <div
              key={item.severity}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5"
            >
              <span className={`text-sm font-medium ${item.color}`}>
                {item.severity}
              </span>
              <span className="text-sm text-[#666]">{item.desc}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Natural Language */}
      <Section title="Natural Language">
        <Paragraph>
          You don&apos;t need to remember slash commands. Just ask Claude
          naturally and the plugin activates:
        </Paragraph>
        <div className="mb-4 space-y-1.5">
          {[
            "Review my code",
            "Check this PR for security issues",
            "Find bugs in my changes",
            "What's wrong with my code?",
            "Octopus review my changes",
          ].map((phrase) => (
            <div
              key={phrase}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5"
            >
              <span className="text-sm text-[#ccc]">&quot;{phrase}&quot;</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Autofix */}
      <Section title="Autofix">
        <Paragraph>
          The autofix skill scans your open PRs for unresolved{" "}
          <Mono>octopus-review[bot]</Mono> comments, presents them with a
          summary, and helps you fix them. Comments from other review tools
          (CodeRabbit, Greptile, etc.) are ignored.
        </Paragraph>
        <CodeBlock>{`# Trigger autofix
"Octopus autofix"
"Octopus fix"`}</CodeBlock>

        <h3 className="mb-2 mt-4 text-sm font-semibold text-white">
          How it works
        </h3>
        <ol className="mb-4 list-inside list-decimal space-y-1.5 text-sm text-[#888]">
          <li>Lists your open PRs and checks for <Mono>octopus-review[bot]</Mono> comments</li>
          <li>Skips PRs where the latest review shows 0 findings</li>
          <li>Presents a summary of actionable feedback and asks for confirmation</li>
          <li>Checks out each PR branch, applies fixes, and commits</li>
          <li>For valid suggestions: reacts with a thumbs up and replies with the fix</li>
          <li>For false positives: reacts with a thumbs down and explains why</li>
          <li>Pushes changes and posts a summary comment tagging @octopusreview</li>
        </ol>
      </Section>

      {/* Autonomous Workflow */}
      <Section title="Autonomous Review-Fix Cycle">
        <Paragraph>
          Combine the review and autofix skills for a fully autonomous workflow:
        </Paragraph>
        <ol className="mb-4 list-inside list-decimal space-y-1.5 text-sm text-[#888]">
          <li>Implement your feature or fix</li>
          <li>
            Ask: <Mono>&quot;review my code&quot;</Mono>
          </li>
          <li>Review findings are posted on the PR</li>
          <li>
            Ask: <Mono>&quot;octopus fix&quot;</Mono>
          </li>
          <li>Fixes are applied, pushed, and summarized on the PR</li>
          <li>
            Ask: <Mono>&quot;review again&quot;</Mono> to verify
          </li>
        </ol>
        <Paragraph>
          Repeat until the review comes back clean.
        </Paragraph>
      </Section>

      {/* Other Capabilities */}
      <Section title="Other Capabilities">
        <Paragraph>
          The plugin also supports these Octopus CLI commands:
        </Paragraph>
        <CommandCard
          command="octopus repo status"
          description="Check indexing progress, analysis results, and auto-review status."
        />
        <CommandCard
          command="octopus repo index"
          description="Trigger code indexing for better review context."
        />
        <CommandCard
          command="octopus repo analyze"
          description="Run AI analysis to generate a codebase summary."
        />
        <CommandCard
          command="octopus repo chat"
          description="Interactive Q&A about your codebase."
        />
        <CommandCard
          command="octopus usage"
          description="Check monthly token usage, spend limits, and credit balance."
        />
      </Section>

      {/* Plugin Structure */}
      <Section title="Plugin Structure">
        <Paragraph>
          The plugin is entirely Markdown-based with no compiled code. Claude
          Code reads these files and uses them as instructions.
        </Paragraph>
        <CodeBlock>{`.claude-plugin/
  plugin.json              # Plugin manifest
agents/
  code-reviewer.md         # Specialized code review agent
commands/
  review.md                # /review slash command
skills/
  autofix/
    SKILL.md               # Autofix skill (scan PRs, fix review comments)
  code-review/
    SKILL.md               # Code review skill (natural language triggers)`}</CodeBlock>
      </Section>

      {/* Source Code */}
      <Section title="Source Code">
        <Paragraph>
          The plugin is open source. Contributions are welcome.
        </Paragraph>
        <a
          href="https://github.com/octopusreview/claude-plugin"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.04] px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/[0.08]"
        >
          <IconBrandGithub className="size-4" />
          View on GitHub
        </a>
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

function CommandCard({
  command,
  description,
}: {
  command: string;
  description: string;
}) {
  return (
    <div className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <code className="text-sm font-medium text-white">{command}</code>
      <p className="mt-1 text-sm text-[#666]">{description}</p>
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
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-2 text-white">{icon}</div>
      <div className="mb-1 text-sm font-medium text-white">{title}</div>
      <div className="text-xs text-[#666]">{description}</div>
    </div>
  );
}
