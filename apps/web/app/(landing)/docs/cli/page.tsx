import { IconTerminal2 } from "@tabler/icons-react";

export const metadata = {
  title: "CLI — Octopus Docs",
  description:
    "Install and use the Octopus CLI to review PRs, index repos, and chat with your codebase from the terminal.",
};

export default function CLIPage() {
  return (
    <article className="prose-invert max-w-3xl">
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
        <CodeBlock>npm install -g @octp/cli</CodeBlock>
        <Paragraph>Or with bun:</Paragraph>
        <CodeBlock>bun add -g @octp/cli</CodeBlock>
      </Section>

      {/* Auth */}
      <Section title="Authentication">
        <Paragraph>
          Log in to connect the CLI with your Octopus account. This opens a
          browser window for authentication.
        </Paragraph>
        <CodeBlock>octopus login</CodeBlock>
        <Paragraph>You can also authenticate with an API token directly:</Paragraph>
        <CodeBlock>octopus login --token oct_your_token_here</CodeBlock>
        <Paragraph>
          Verify your session with <Mono>whoami</Mono>:
        </Paragraph>
        <CodeBlock>octopus whoami</CodeBlock>
      </Section>

      {/* Repo commands */}
      <Section title="Repository Commands">
        <Paragraph>
          Manage your repositories. When run inside a git repo, the{" "}
          <Mono>[repo]</Mono> argument is auto-detected from the git remote.
        </Paragraph>

        <CommandCard
          command="octopus repo list"
          description="List all repositories in your organization."
        />
        <CommandCard
          command="octopus repo status [repo]"
          description="Show detailed status — indexing progress, analysis results, PR count."
        />
        <CommandCard
          command="octopus repo index [repo]"
          description="Index a repository for code search and review context. Polls until complete."
        />
        <CommandCard
          command="octopus repo analyze [repo]"
          description="Run AI analysis to generate a codebase summary and architecture overview."
        />
        <CommandCard
          command="octopus repo chat [repo]"
          description="Start an interactive chat session about your codebase. Ask questions, explore architecture."
        />
      </Section>

      {/* PR commands */}
      <Section title="Pull Request Commands">
        <CommandCard
          command="octopus pr review <pr>"
          description="Trigger an AI review on a pull request. Accepts a PR number or full URL."
        />
        <Paragraph>Examples:</Paragraph>
        <CodeBlock>{`octopus pr review 42
octopus pr review https://github.com/owner/repo/pull/42`}</CodeBlock>
      </Section>

      {/* Knowledge commands */}
      <Section title="Knowledge Base">
        <Paragraph>
          Add custom documents to your organization&apos;s knowledge base.
          Octopus uses these during reviews for deeper context.
        </Paragraph>

        <CommandCard
          command="octopus knowledge list"
          description="List all knowledge documents."
        />
        <CommandCard
          command='octopus knowledge add <file> [--title "Title"]'
          description="Upload a file to the knowledge base."
        />
        <CommandCard
          command="octopus knowledge remove <id>"
          description="Remove a knowledge document."
        />
      </Section>

      {/* Config & Usage */}
      <Section title="Configuration & Usage">
        <CommandCard
          command="octopus config list"
          description="List all CLI profiles."
        />
        <CommandCard
          command="octopus config set <key> <value>"
          description="Set a config value (apiUrl, activeProfile)."
        />
        <CommandCard
          command="octopus usage"
          description="Show monthly token usage, spend limits, and credit balance."
        />
        <CommandCard
          command="octopus logout"
          description="Remove saved credentials."
        />
      </Section>

      {/* Profiles */}
      <Section title="Multiple Profiles">
        <Paragraph>
          Use profiles to switch between different accounts or organizations:
        </Paragraph>
        <CodeBlock>{`octopus login --profile work
octopus login --profile personal
octopus config set activeProfile work`}</CodeBlock>
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

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mb-4 overflow-x-auto rounded-lg border border-white/[0.06] bg-[#161616] px-4 py-3">
      <code className="text-sm text-[#ccc]">{children}</code>
    </pre>
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
