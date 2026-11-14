import Link from "@/components/link";
import { docsPageJsonLd, jsonLd } from "@/lib/structured-data";
import { IconTerminal2 } from "@tabler/icons-react";
import { CodeBlock } from "../self-hosting/code-block";

export const metadata = {
  title: "CLI",
  description:
    "Install the Octopus CLI and review pull requests, index repositories, or chat with your codebase from the terminal. Works with GitHub, GitLab, and Bitbucket today.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/cli",
  },
};

export default function CLIPage() {
  return (
    <article className="prose-invert max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            docsPageJsonLd({
              title: metadata.title,
              description: metadata.description,
              path: "/docs/cli",
              crumb: "CLI",
            }),
          ),
        }}
      />
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconTerminal2 className="size-4" />
          CLI
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Octopus CLI
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          Review PRs, index repos, and chat with your codebase — all from the
          terminal.
        </p>
      </div>

      {/* Install */}
      <Section title="Installation">
        <CodeBlock>curl -fsSL https://octopus-review.ai/install.sh | bash</CodeBlock>
        <Paragraph>Or on Windows (PowerShell):</Paragraph>
        <CodeBlock>{`powershell -c "irm https://octopus-review.ai/install.ps1 | iex"`}</CodeBlock>
      </Section>

      <Section title="Let your AI handle setup">
        <Paragraph>
          Give the <Link href="/#agent-setup" className="text-white underline">homepage setup prompt</Link> to the AI working in your project.
          With octp 0.5.0 or later, it can connect your GitHub repository, start or join indexing and analysis, and check the result through the CLI.
        </Paragraph>
        <CodeBlock>octp onboard --agent --json</CodeBlock>
        <Paragraph>
          Run this from the project directory, or supply <Mono>--repo owner/name</Mono>.
          Use <Mono>--account name</Mono> to select a saved user profile, and <Mono>--org slug</Mono> to choose an organisation for one command.
        </Paragraph>
        <Paragraph>
          If sign-in is needed, the AI runs the returned login command with <Mono>--no-open</Mono>,
          gives you the approval URL, and keeps that process running while you approve.
          GitHub App installation and repository access also return approval links.
          Approve those in your browser, then let the AI continue through the CLI.
        </Paragraph>
        <Paragraph>
          Agent setup currently supports github.com repositories. Existing organisation settings stay in place;
          dismissed repositories and failed jobs need explicit attention. If login is interrupted, start it again.
          See the <Link href="https://github.com/octopusreview/octopus/blob/master/apps/cli/README.md#set-up-a-repository-with-your-ai" className="text-white underline">agent protocol reference</Link> for
          JSON fields, continuation arguments, exit codes and recovery limits.
        </Paragraph>
      </Section>

      {/* Auth */}
      <Section title="Authentication">
        <Paragraph>
          Log in to connect the CLI with your Octopus account. This opens a
          browser window for authentication.
        </Paragraph>
        <CodeBlock>octp login</CodeBlock>
        <p className="text-[#a0a0a0]">
          CLI 0.6.0 with server 1.0.157 signs you in once without selecting an organisation in the browser.
          Your session lasts 30 days. Run <Mono>octp logout</Mono> to revoke it.
        </p>
        <CodeBlock>{`octp org list --json
octp --org acme onboard --agent --json --repo acme/app
octp --org another-org repo list`}</CodeBlock>
        <p className="text-[#a0a0a0]">
          Without <Mono>--org</Mono>, repository setup uses a unique repository or GitHub owner match.
          If it cannot choose safely, it returns <Mono>organization_required</Mono> with your available organisations
          before starting work. Choose one and retry. Existing organisation tokens keep their original scope;
          run <Mono>octp login</Mono> again to enable switching.
        </p>
        <Paragraph>You can also authenticate with an API token directly:</Paragraph>
        <CodeBlock>octp login --token oct_your_token_here</CodeBlock>
        <Paragraph>
          Need a token for CI/CD or a script? Use <Mono>setup-token</Mono>. It
          uses organisation-scoped browser approval and prints the token to stdout
          (progress messages go to stderr) so it can be captured directly:
        </Paragraph>
        <CodeBlock>{`# Print token to stdout
octp setup-token

# Capture into an environment variable
export OCTOPUS_TOKEN=$(octp setup-token)

# Save into a local profile while also printing
octp setup-token --save --profile ci

# Headless box (no browser): URL is written to stderr so you can open it elsewhere
octp setup-token --no-open`}</CodeBlock>
        <Paragraph>
          Prefer a manually-managed, named token? Create one at{" "}
          <Link
            href="/settings/api-tokens"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            Settings → API Tokens
          </Link>{" "}
          and pass it with <Mono>octp login --token oct_...</Mono>.
        </Paragraph>
        <Paragraph>
          Verify your session with <Mono>whoami</Mono>:
        </Paragraph>
        <CodeBlock>octp whoami</CodeBlock>
      </Section>

      {/* Repo commands */}
      <Section title="Repository Commands">
        <Paragraph>
          Manage your repositories. When run inside a git repo, the{" "}
          <Mono>[repo]</Mono> argument is auto-detected from the git remote.
        </Paragraph>

        <CommandCard
          command="octp repo list"
          description="List all repositories in your organization."
        />
        <CommandCard
          command="octp repo status [repo]"
          description="Show detailed status — indexing progress, analysis results, PR count."
        />
        <CommandCard
          command="octp repo index [repo]"
          description="Index a repository for code search and review context. Polls until complete."
        />
        <CommandCard
          command="octp repo analyze [repo]"
          description="Run AI analysis to generate a codebase summary and architecture overview."
        />
        <CommandCard
          command="octp chat [repo]"
          description="Start an interactive chat session about your codebase. Ask questions, explore architecture."
        />
      </Section>

      <Section title="Review Local Changes">
        <Paragraph>
          Run these from your Git repository. The first command can include commits
          since the upstream branch and unstaged tracked changes, but may omit
          staged-only changes. Inspect the intended diff first; use the second
          command for staged changes. Untracked files are not included.
        </Paragraph>
        <CodeBlock>{`octp review --no-index --format json
octp review --staged --no-index --format json`}</CodeBlock>
        <Paragraph>
          Reviews send the selected diff to your configured Octopus server and use
          your organisation&apos;s review budget. <Mono>--no-index</Mono> skips new
          working-tree indexing; existing repository context can still be used.
          If the output reports <Mono>truncated: true</Mono>, split the changes
          before treating the review as complete.
        </Paragraph>
      </Section>

      {/* PR commands */}
      <Section title="Pull Request Commands">
        <CommandCard
          command="octp review --pr <pr>"
          description="Trigger an AI review on a pull request. Accepts a PR number or full GitHub, GitLab, or Bitbucket PR URL."
        />
        <Paragraph>Examples:</Paragraph>
        <CodeBlock>{`octp review --pr 42
octp review --pr https://github.com/owner/repo/pull/42`}</CodeBlock>
        <Paragraph>
          For Forgejo, run the command from the connected repository checkout and
          use its PR number; native CLI 0.6.0 does not accept Forgejo PR URLs.
          This queues a review that posts comments on the pull request. A successful
          command confirms the request was accepted. Follow completion in{" "}
          <Link href="/review-logs" className="text-white underline">Review Logs</Link>
          {" "}and on the pull request.
        </Paragraph>
      </Section>

      {/* Dependency Analysis */}
      <Section title="Dependency Analysis">
        <Paragraph>
          Analyze npm dependencies in a GitHub repository for security risks.
          Results stream in real-time with risk categorization.
        </Paragraph>
        <CommandCard
          command="octp analyze-deps <repo-url>"
          description="Scan a repository's npm dependencies for known vulnerabilities, malicious packages, and supply chain risks."
        />
        <Paragraph>Example:</Paragraph>
        <CodeBlock>octp analyze-deps https://github.com/acme/backend</CodeBlock>
      </Section>

      {/* Knowledge commands */}
      <Section title="Knowledge Base">
        <Paragraph>
          Add custom documents to your organization&apos;s knowledge base.
          Octopus uses these during reviews for deeper context.
        </Paragraph>

        <CommandCard
          command="octp knowledge list"
          description="List all knowledge documents."
        />
        <CommandCard
          command='octp knowledge add <file> [--title "Title"]'
          description="Upload a file to the knowledge base."
        />
        <CommandCard
          command="octp knowledge remove <id>"
          description="Remove a knowledge document."
        />
      </Section>

      {/* Local Agent */}
      <Section title="Local Agent">
        <Paragraph>
          Run a local agent on your machine to supercharge Octopus Chat with
          real-time code search. When someone asks a question in chat, the agent
          searches your actual source code (via ripgrep, with a pure-Node
          fallback) and returns precise results — much more accurate than
          embeddings alone.
        </Paragraph>

        <CommandCard
          command="octp agent watch [path]"
          description="Add a directory to the agent's watch list. Detects the repository from the git remote URL."
        />
        <CodeBlock>{`# Watch current directory
octp agent watch

# Watch a specific path
octp agent watch ~/Repos/api

# List all watched directories
octp agent watch --list

# Remove a directory from the watch list
octp agent watch --remove`}</CodeBlock>

        <CommandCard
          command="octp agent serve"
          description="Start the local agent daemon. Registers with Octopus and listens for search requests from chat."
        />
        <CodeBlock>{`# Start the agent (ripgrep-backed code search)
octp agent serve

# Verbose mode for debugging
octp agent serve --verbose`}</CodeBlock>

        <Paragraph>
          The agent identifies repositories by their <Mono>git remote URL</Mono>,
          not the folder name — so you can clone a repo to any directory and the
          agent will still match it correctly. When chat receives a question, the
          server dispatches a search request to any online agent that has the
          relevant repo. Results are merged with RAG context for more accurate
          answers.
        </Paragraph>
        <Paragraph>
          Use a distinct organization API token for each agent that needs an
          independent security boundary. Agents configured with the same token
          intentionally share task and repository authority.
        </Paragraph>

        <div className="mb-3 space-y-1.5">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
            <span className="text-sm text-[#888]">Code search: </span>
            <span className="text-sm text-[#ccc]">ripgrep-backed keyword search, with a pure-Node file-walker fallback when ripgrep isn&apos;t installed</span>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
            <span className="text-sm text-[#888]">LLM tasks: </span>
            <span className="text-sm text-[#ccc]">optional, served by a local Ollama instance — no cloud calls</span>
          </div>
        </div>
      </Section>

      {/* AI agent integration */}
      <Section title="Use with Your AI Agent">
        <Paragraph>
          Claude Code, Codex, OpenCode, Hermes, OpenClaw, and Cursor can use the
          native Octopus CLI through their shell tools. Follow the setup guide
          for your agent, including an optional Octopus skill and a connection check.
        </Paragraph>
        <Link
          href="/docs/cli/ai-agents"
          className="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.04] px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/[0.08]"
        >
          Set up your AI agent →
        </Link>
      </Section>

      {/* Skills */}
      <Section title="Skills">
        <Paragraph>
          The <Mono>octp skills</Mono> commands install the existing Claude Code
          command library into <Mono>.claude/commands</Mono> in your current
          project. Sign in first, then run them from the project root. See the{" "}
          <Link
            href="/docs/skills"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            Skills docs
          </Link>{" "}
          for details on each skill.
        </Paragraph>

        <CommandCard
          command="octp skills list"
          description="List available Octopus skills."
        />
        <CodeBlock>{`$ octp skills list

  Skill        Description
  octopus-fix  Check open PRs for review comments, apply fixes, and push updates`}</CodeBlock>

        <CommandCard
          command="octp skills install <name>"
          description="Install a named command into this project's .claude/commands directory."
        />
        <CodeBlock>{`# Install one command
octp skills install octopus-fix

# Install the whole command library
octp skills install --all`}</CodeBlock>
        <Paragraph>
          Use <Mono>/octopus-fix</Mono> in Claude Code after installation. For
          Codex and other agents, use the separate{" "}
          <Link href="/docs/cli/ai-agents" className="text-white underline">
            AI agent setup guide
          </Link>
          .
        </Paragraph>
      </Section>

      {/* Config & Usage */}
      <Section title="Configuration & Usage">
        <CommandCard
          command="octp config list"
          description="List all CLI profiles."
        />
        <CommandCard
          command="octp config set <key> <value>"
          description="Set a config value (apiUrl, activeProfile)."
        />
        <CommandCard
          command="octp usage"
          description="Show monthly token usage, spend limits, and credit balance."
        />
        <CommandCard
          command="octp logout"
          description="Remove saved credentials."
        />
      </Section>

      {/* Profiles */}
      <Section title="Multiple Profiles">
        <Paragraph>
          Use profiles for different users or servers. Within one user account, switch organisations with --org:
        </Paragraph>
        <CodeBlock>{`octp login --profile work
octp login --profile personal
octp config set activeProfile work`}</CodeBlock>
      </Section>

      {/* .octopusignore */}
      <Section title=".octopusignore">
        <Paragraph>
          Control which files Octopus reviews and indexes by creating a{" "}
          <Mono>.octopusignore</Mono> file at the root of your repository. It
          uses the same syntax as <Mono>.gitignore</Mono>.
        </Paragraph>
        <CodeBlock>{`# Generated files
docs/generated/**

# Test fixtures
tests/fixtures/**
**/__snapshots__/**

# Vendor / third-party
vendor/**
third-party/**

# Large data files
*.csv
*.parquet`}</CodeBlock>
        <Paragraph>
          Matched files are excluded from both indexing (never chunked or
          embedded) and PR review (the AI reviewer won&apos;t see changes to
          those files).
        </Paragraph>
        <Paragraph>
          See the full{" "}
          <Link
            href="/docs/octopusignore"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            .octopusignore reference
          </Link>{" "}
          for syntax details, common patterns, and provider support.
        </Paragraph>
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
