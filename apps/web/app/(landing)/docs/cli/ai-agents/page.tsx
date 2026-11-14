import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "@/components/link";
import { IconTerminal2 } from "@tabler/icons-react";
import { CodeBlock } from "../../self-hosting/code-block";
import { DocsJsonLd } from "../../docs-json-ld";

export const metadata = {
  title: "AI coding agents",
  description:
    "Use Octopus with Claude Code, Codex, OpenCode, Hermes Agent, OpenClaw, or Cursor through the Octopus CLI and a reusable skill.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/cli/ai-agents",
  },
};

const linkStyle =
  "text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white";

export default async function AiAgentsPage() {
  let skill: string | null = null;
  try {
    skill = (await readFile(
      path.join(process.cwd(), "public", "skills", "octopus", "SKILL.md"),
      "utf-8",
    )).trim() || null;
  } catch {
    // Keep the guide usable if the packaged skill cannot be read.
  }

  return (
    <article className="max-w-3xl">
      <DocsJsonLd title={metadata.title} description={metadata.description} path="/docs/cli/ai-agents" crumb={metadata.title} />
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#888]">
          <IconTerminal2 className="size-4" />
          CLI / AI coding agents
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          AI coding agents
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-[#a0a0a0]">
          Ask your coding agent to use Octopus for code reviews. Install the
          Octopus CLI, then add a small skill file that teaches your agent how to
          use it.
        </p>
      </div>

      <nav aria-label="Choose your coding agent" className="mb-8 flex flex-wrap gap-2">
        {[
          ["claude-code", "Claude Code"],
          ["codex", "Codex"],
          ["opencode", "OpenCode"],
          ["hermes", "Hermes Agent"],
          ["openclaw", "OpenClaw"],
          ["cursor", "Cursor"],
        ].map(([id, label]) => (
          <Link key={id} href={`#${id}`} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white transition-colors hover:bg-white/[0.06]">
            {label}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="get-started" className="mb-10">
        <h2 id="get-started" className="mb-4 scroll-mt-24 text-xl font-semibold text-white">Set up once</h2>
        <ol className="space-y-4">
          <li className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h3 className="mb-2 font-semibold text-white">1. Install and sign in to Octopus</h3>
            <p className="text-sm leading-relaxed text-[#a0a0a0]">
              Follow the <Link href="/docs/cli" className={linkStyle}>CLI installation and login guide</Link> in
              the environment where your agent runs commands. For a remote agent,
              container, or sandbox, install and authenticate there too.
              Complete sign-in yourself; keep tokens out of prompts and skill files.
            </p>
          </li>
          <li className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h3 className="mb-2 font-semibold text-white">2. Check the agent can use it</h3>
            <p className="mb-3 text-sm leading-relaxed text-[#a0a0a0]">
              Open your project in the agent and ask it to run these commands in
              its own terminal. Confirm the expected Octopus account before continuing.
            </p>
            <CodeBlock title="Check the CLI and account">{`octp --version\noctp whoami`}</CodeBlock>
            <p className="text-sm leading-relaxed text-[#a0a0a0]">
              These checks do not start a review. Your agent needs permission to
              execute shell commands and reach your Octopus instance.
            </p>
          </li>
          <li className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h3 className="mb-2 font-semibold text-white">3. Add the Octopus skill</h3>
            {skill ? (
              <>
                <p className="text-sm leading-relaxed text-[#a0a0a0]">
                  <Link href="/skills/octopus/SKILL.md" download="SKILL.md" className={linkStyle}>Download SKILL.md</Link> or
                  copy it below. Save it at the location shown for your tool, keeping
                  the filename <Mono>SKILL.md</Mono>. The skill gives your agent
                  instructions; the installed <Mono>octp</Mono> CLI performs the work.
                </p>
                <details className="mt-4 rounded-lg border border-white/10">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white">View and copy the skill</summary>
                  <div className="min-w-0 px-4 pb-1">
                    <CodeBlock title="SKILL.md">{skill}</CodeBlock>
                  </div>
                </details>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-[#a0a0a0]">
                The skill file is temporarily unavailable. You can still use the{" "}
                <Link href="#first-review" className={linkStyle}>CLI commands below</Link>.
              </p>
            )}
          </li>
        </ol>
        <p className="mt-4 text-sm leading-relaxed text-[#a0a0a0]">
          Reviews send selected code and context to your Octopus instance and its
          configured AI provider. They may use Octopus credits or incur provider
          charges, separately from your coding agent subscription.
        </p>
      </section>

      <section aria-labelledby="choose-agent" className="mb-10">
        <h2 id="choose-agent" className="mb-4 scroll-mt-24 text-xl font-semibold text-white">Choose your agent</h2>
        <p className="mb-4 text-sm leading-relaxed text-[#a0a0a0]">
          Paths below are relative to your project unless stated otherwise.
          Codex, OpenCode, Hermes, OpenClaw, and Cursor can share one{" "}
          <Mono>.agents/skills/octopus/SKILL.md</Mono> file.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <AgentCard id="claude-code" title="Claude Code" docs="https://code.claude.com/docs/en/skills">
            <p>Save the file as <Mono>.claude/skills/octopus/SKILL.md</Mono>.</p>
            <p>Open Claude Code in the project, then enter <Mono>/octopus</Mono> or ask it to use the Octopus skill.</p>
            <p>For the separately packaged plugin, see the <Link href="/docs/cli/claude-code-integration" className={linkStyle}>Claude Code integration guide</Link>.</p>
          </AgentCard>
          <AgentCard id="codex" title="Codex" docs="https://learn.chatgpt.com/docs/build-skills">
            <p>Save the file as <Mono>.agents/skills/octopus/SKILL.md</Mono>.</p>
            <p>Open the project in Codex, then invoke <Mono>$octopus</Mono> or ask it to use the Octopus skill.</p>
            <p>The CLI and login must be available in the environment used by that Codex session.</p>
          </AgentCard>
          <AgentCard id="opencode" title="OpenCode" docs="https://opencode.ai/docs/skills/">
            <p>Save the file as <Mono>.agents/skills/octopus/SKILL.md</Mono>. OpenCode also supports <Mono>.opencode/skills/octopus/SKILL.md</Mono>.</p>
            <p>Start OpenCode in the project and ask: “Use the octopus skill to check my Octopus connection.”</p>
            <p>OpenCode loads the skill on demand and uses its shell tool to run the CLI.</p>
          </AgentCard>
          <AgentCard id="hermes" title="Hermes Agent" docs="https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/#project-local-skills">
            <p>For Nous Research&apos;s Hermes Agent, save the file as <Mono>.agents/skills/octopus/SKILL.md</Mono>.</p>
            <p>Review the skill, then run <Mono>hermes skills trust</Mono> from the project root. This allows Hermes to load that project&apos;s skills.</p>
            <p>Start Hermes, use <Mono>/skills</Mono> to check it appears, then invoke <Mono>/octopus</Mono>. Install and authenticate the CLI inside your configured terminal backend if it uses Docker or SSH.</p>
          </AgentCard>
          <AgentCard id="openclaw" title="OpenClaw" docs="https://docs.openclaw.ai/tools/skills">
            <p>Save the file as <Mono>.agents/skills/octopus/SKILL.md</Mono> inside the configured agent workspace. The native alternative is <Mono>skills/octopus/SKILL.md</Mono>.</p>
            <p>Check discovery with <Mono>openclaw skills info octopus</Mono>, then start a new session and invoke <Mono>/octopus</Mono>.</p>
            <p>The <Mono>octp</Mono> binary and login must be available on the host, node, or sandbox where OpenClaw executes commands.</p>
          </AgentCard>
          <AgentCard id="cursor" title="Cursor" docs="https://cursor.com/docs/skills">
            <p>Save the file as <Mono>.agents/skills/octopus/SKILL.md</Mono>, then open the project in Cursor.</p>
            <p>Open <strong className="font-medium text-white">Customize → Skills</strong> to check it appears, then invoke <Mono>/octopus</Mono> in Agent chat.</p>
            <p>For a cloud or remote agent, make the CLI and login available in that agent&apos;s environment.</p>
          </AgentCard>
        </div>
      </section>

      <section id="first-review" className="mb-10 scroll-mt-24">
        <h2 className="mb-4 text-xl font-semibold text-white">Run your first review</h2>
        <p className="mb-3 text-sm leading-relaxed text-[#a0a0a0]">
          In your repository, stage the changes you want reviewed. Ask your agent
          to use the Octopus skill to review that staged diff, or run:
        </p>
        <CodeBlock title="Review staged changes">octp review --staged --no-index --format json</CodeBlock>
        <p className="mb-5 text-sm leading-relaxed text-[#a0a0a0]">
          <Mono>--staged</Mono> selects the staged diff. <Mono>--no-index</Mono> prevents
          starting a new index; existing indexed context may still be used.{" "}
          <Mono>--format json</Mono> gives your agent structured findings to read
          before suggesting fixes.
        </p>
        <h3 className="mb-2 font-semibold text-white">Review an existing pull request</h3>
        <CodeBlock title="Request a PR review">octp review --pr 42</CodeBlock>
        <p className="text-sm leading-relaxed text-[#a0a0a0]">
          Run this from the matching repository and replace <Mono>42</Mono> with
          your PR number. Use the number for Forgejo too; native CLI 0.6.0 does
          not accept Forgejo PR URLs. It queues a review and posts the result to the PR when
          finished. A queued response is not a completed review. Follow progress
          in <Link href="/review-logs" className={linkStyle}>Review Logs</Link>.
        </p>
      </section>

      <p className="mb-6 text-xs leading-relaxed text-[#888]">CLI commands checked against native octp 0.6.0. Agent setup paths follow each tool&apos;s linked documentation; confirm skill discovery and the connection in your own session before reviewing code.</p>

      <details className="mb-10 rounded-xl border border-white/10">
        <summary className="cursor-pointer px-5 py-4 font-semibold text-white">The skill or CLI is not showing up</summary>
        <ul className="list-disc space-y-3 px-9 pb-5 text-sm leading-relaxed text-[#a0a0a0]">
          <li>Check the file&apos;s location, uppercase filename, and <Mono>name: octopus</Mono> frontmatter. Start a new agent session after saving it.</li>
          <li>Ask the agent to run <Mono>octp --version</Mono> in its terminal. If the command is missing, install it on that host or in that sandbox and make it available on <Mono>PATH</Mono>.</li>
          <li>If <Mono>octp whoami</Mono> fails, complete <Mono>octp login</Mono> in the same execution environment.</li>
          <li>If a command differs from this guide, inspect <Mono>octp --help</Mono> and update using the <Link href="/docs/cli" className={linkStyle}>CLI guide</Link>. Agent skill discovery also depends on your tool&apos;s version and permissions.</li>
        </ul>
      </details>
    </article>
  );
}

function AgentCard({ id, title, docs, children }: { id: string; title: string; docs: string; children: React.ReactNode }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-24 rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <h3 className="mb-3 text-lg font-semibold text-white">{title}</h3>
      <div className="space-y-3 text-sm leading-relaxed text-[#a0a0a0]">{children}</div>
      <p className="mt-4 text-sm"><Link href={docs} className={linkStyle}>{title} skill guide ↗</Link></p>
    </section>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-[#ccc] [overflow-wrap:anywhere]">{children}</code>;
}
