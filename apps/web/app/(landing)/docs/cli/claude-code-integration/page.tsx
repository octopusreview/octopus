import Link from "@/components/link";
import { CodeBlock } from "../../self-hosting/code-block";
import { DocsJsonLd } from "../../docs-json-ld";

export const metadata = {
  title: "Claude Code Integration",
  description: "Install the Octopus Review plugin from its publisher marketplace, configure your token, and check the connection in Claude Code. A CLI and skill setup is also available.",
  alternates: { canonical: "https://octopus-review.ai/docs/cli/claude-code-integration" },
};

const linkClass = "text-cyan-400 underline underline-offset-4";

export default function ClaudeCodeIntegrationPage() {
  return (
    <article className="max-w-3xl text-sm leading-relaxed text-[#aaa] [&_code]:[overflow-wrap:anywhere]">
      <DocsJsonLd title={metadata.title} description={metadata.description} path="/docs/cli/claude-code-integration" crumb={metadata.title} />
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#888]">CLI / AI coding agents</p>
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Claude Code integration</h1>
      <p className="mb-6 mt-3 text-lg">Use the Octopus Review plugin to request reviews from Claude Code. It connects through an MCP server and uses an Octopus organization API token.</p>
      <div className="mb-8 border border-cyan-400/25 bg-cyan-400/5 p-5">
        <h2 className="mb-2 text-base font-semibold text-white">Use the current plugin name</h2>
        <p>The plugin is <code>octopus-review</code> in the publisher&apos;s <code>octopus-review</code> marketplace. Add that marketplace before installing. The old <code>claude plugin install octopus</code> instruction is incomplete and points to a different, legacy plugin.</p>
      </div>
      <Section id="prerequisites" title="1. Have these ready">
        <ul className="list-disc space-y-2 pl-5">
          <li>A current version of <a className={linkClass} href="https://code.claude.com/docs/en/overview">Claude Code</a>, plus <a className={linkClass} href="https://nodejs.org/en/download">Node.js</a> 18 or later with <code>npx</code>, and Git.</li>
          <li>An Octopus account. Open <Link className={linkClass} href="/settings/api-tokens">Settings → API Tokens</Link> and create an organization API token for the organization you want to use.</li>
          <li>Network access from Claude&apos;s environment to GitHub, the npm registry, and Octopus Cloud. The MCP server runs in that environment.</li>
        </ul>
        <p className="mt-3">The plugin does not require the Octopus CLI. Reviews send code or diffs to Octopus and its configured AI services and use your organization&apos;s credits or provider budget. Keep your token out of chat messages and Git.</p>
      </Section>
      <Section id="install" title="2. Install from the publisher marketplace">
        <p className="mb-3">Run these commands in your terminal:</p>
        <CodeBlock title="Terminal">{`claude plugin marketplace add octopusreview/octopus-plugin
claude plugin install octopus-review@octopus-review`}</CodeBlock>
        <details className="border border-white/10 p-4">
          <summary className="cursor-pointer font-medium text-white">Already inside Claude Code?</summary>
          <div className="mt-3"><CodeBlock title="Inside Claude Code">{`/plugin marketplace add octopusreview/octopus-plugin
/plugin install octopus-review@octopus-review`}</CodeBlock></div>
        </details>
        <p className="mt-3">This is Octopus&apos;s own marketplace. You do not need to find it in Anthropic&apos;s official catalog.</p>
      </Section>
      <Section id="configure" title="3. Add your token and reconnect">
        <p className="mb-3">Inside Claude Code, open the plugin&apos;s configuration and enter your token in the sensitive <code>api_token</code> field:</p>
        <CodeBlock title="Inside Claude Code">/plugin configure octopus-review@octopus-review</CodeBlock>
        <p>Restart Claude Code after setup. Open <code>/mcp</code> and check that the <code>octopus</code> server connects. Then ask:</p>
        <CodeBlock title="Connection check">Use octopus_status to check my Octopus connection and tell me which organization it uses. Do not start a review.</CodeBlock>
        <p>Confirm the organization before sending code. Installing the plugin alone does not authenticate it or confirm that a review has completed.</p>
      </Section>
      <Section id="first-review" title="4. Request a review">
        <p className="mb-3">Open your Git repository in Claude Code. For tracked changes in the working tree and staging area, ask:</p>
        <CodeBlock title="Review changes">Use Octopus to review my current tracked changes in this repository. Show the findings before making any edits.</CodeBlock>
        <p className="mb-3">The plugin reads <code>git diff HEAD</code>; untracked files are not included. This sends the diff for review and returns a brief findings summary in Claude Code. For structured findings, use the CLI and skill guide below. For a connected repository&apos;s pull request, ask:</p>
        <CodeBlock title="Review a pull request">Use Octopus to request a review of PR 42 in this repository.</CodeBlock>
        <p>Replace <code>42</code> with your PR number. A successful request queues the PR review; follow its progress in <Link className={linkClass} href="/review-logs">Review Logs</Link> and check the resulting comments on the PR. It is not a completed review at submission time.</p>
        <p className="mt-3">To find the plugin&apos;s slash command, type <code>/octopus-review:</code> and select its review command. The old unqualified <code>/review</code> is not the command documented by this plugin.</p>
      </Section>
      <Section id="troubleshooting" title="If setup does not work">
        <dl className="space-y-4">
          <div><dt className="font-medium text-white">Plugin not found</dt><dd>Add the publisher marketplace in step 2, then use the full <code>octopus-review@octopus-review</code> name.</dd></div>
          <div><dt className="font-medium text-white">Token missing or unauthorized</dt><dd>Reopen the plugin configuration, check the organization token, then restart Claude Code and run the connection check again.</dd></div>
          <div><dt className="font-medium text-white">MCP server cannot start</dt><dd>Check <code>node --version</code>, <code>npx --version</code>, Git, and outbound network access in the environment running Claude. Open <code>/mcp</code> for its error details.</dd></div>
          <div><dt className="font-medium text-white">No changes or diff too large</dt><dd>The plugin reviews tracked diffs and is limited by the Octopus API to 500 KiB. Use a smaller change set or request a server-side PR review for a connected repository.</dd></div>
        </dl>
      </Section>
      <Section id="cli-alternative" title="Prefer the CLI, or use another coding agent?">
        <p>The <Link className={linkClass} href="/docs/cli/ai-agents">AI coding agents guide</Link> provides a CLI and skill setup for Claude Code, Codex, OpenCode, Hermes Agent, OpenClaw, and Cursor. Use that path for the native <code>octp</code> workflow or your configured self-hosted Octopus server.</p>
        <p className="mt-3">The legacy <a className={linkClass} href="https://github.com/octopusreview/claude-plugin">claude-plugin repository</a> installs after adding its separate marketplace, but its review instructions still call the old <code>octopus</code> executable. Use the current plugin above or the CLI guide instead.</p>
      </Section>
      <details className="mb-8 border border-white/10 p-4">
        <summary className="cursor-pointer font-medium text-white">Current plugin limitations</summary>
        <p className="mt-3">Plugin 0.1.0 returns brief local findings and omits detailed explanations and suggested fixes from the API response. Its chat tool can show a partial answer if the server reports an error mid-stream. Use the native CLI for structured review results, and check the final PR result before acting on a queued review.</p>
      </details>
      <p className="border-t border-white/10 pt-5 text-xs text-[#888]">Installation and component discovery checked with Claude Code 2.1.276 on 20 September 2026. An authenticated review is a separate verification step. <a className={linkClass} href="https://github.com/octopusreview/octopus-plugin">Plugin source</a> · <a className={linkClass} href="https://code.claude.com/docs/en/discover-plugins">Claude plugin documentation</a></p>
    </article>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="mb-8 scroll-mt-24 [&_code]:[overflow-wrap:anywhere]"><h2 className="mb-3 text-xl font-semibold text-white">{title}</h2>{children}</section>;
}
