/**
 * Plain-text content extracted from the landing page and documentation pages.
 * Used for seeding the docs_chunks Qdrant collection so the "Ask Octopus"
 * public chat can answer questions about the product.
 *
 * When a docs page is updated, update the corresponding entry here and
 * re-run POST /api/admin/seed-docs.
 */

export interface DocsDocument {
  page: string;
  title: string;
  sections: { heading: string; text: string }[];
}

export const docsContent: DocsDocument[] = [
  // ─── Landing Page ───────────────────────────────────────────────
  {
    page: "landing",
    title: "Octopus — AI Code Reviewer",
    sections: [
      {
        heading: "Hero",
        text: `Octopus — Review every PR with repo context.
Octopus reviews every pull request with deep context awareness. Catch bugs, enforce standards, and ship with confidence.
Octopus is a source-available, AI-powered code review tool.`,
      },
      {
        heading: "How It Works",
        text: `Step 1: Connect your repository. Use the GitHub App, GitLab or Bitbucket OAuth, or Forgejo. For Forgejo choose Cloud + public HTTPS (direct), Cloud + private LAN/VPN (local connector), or self-hosted Octopus + private LAN/VPN (direct). All Forgejo connections use a personal access token and signed repository webhooks.
Step 2: AI Learns Your Code — Octopus indexes your codebase, creating vector embeddings of your code chunks. It understands your architecture, patterns, and conventions.
Step 3: Reviews on Autopilot — Every pull request is automatically reviewed. Octopus posts findings as inline comments with severity levels: Critical, Major, Minor, Suggestion, and Tip.`,
      },
      {
        heading: "Cloud or Self-Host",
        text: `Two ways to run Octopus. Cloud: a managed service with reviews for GitHub, GitLab, Bitbucket and Forgejo. Forgejo can connect directly over public HTTPS or through a local connector for private LAN/VPN access. The connector and Forgejo both need outbound HTTPS to Cloud. Free credits to start, then usage-based pricing. Self-host: run Octopus with Docker Compose on your own infrastructure. It is free and source-available (Modified MIT License). You choose the AI services; external services receive code for processing. Use local services when processing must stay on your network.`,
      },
      {
        heading: "Stats",
        text: `The homepage displays four live, real-time platform counters, computed dynamically from the production database: Code Chunks indexed, Findings posted, PR Reviews completed, and Repositories connected. These figures update in real time and are not fixed marketing numbers. Octopus does not advertise a specific speed multiplier, bug-catch percentage, or average review time.`,
      },
      {
        heading: "Features",
        text: `RAG Chat — Ask questions about your codebase and get answers with file citations. Context-aware AI chat powered by vector search.
CLI Tool — Review PRs, chat with your codebase, and manage knowledge from your terminal. Command: octp review --pr 142.
Codebase Indexing — Your entire codebase is chunked, embedded, and indexed for semantic search. Embeddings are created using OpenAI text-embedding-3-large with 3072 dimensions.
Knowledge Base — Add custom documents, guidelines, and rules that Octopus references during reviews. Enforce your team's standards automatically.
Team — Share one setup. Org rules, repositories, and reviewer settings stay aligned across your team.
Analytics — Track review activity, time to merge, token usage, and costs across your organization.`,
      },
      {
        heading: "Source-Available",
        text: `Octopus is source-available under a Modified MIT License and free to self-host.
Self-Host Ready — Run Octopus on your own infrastructure with one Docker Compose file. Choose local AI services to keep processing on your network, or configure external AI providers.`,
      },
      {
        heading: "FAQ",
        text: `Q: What is Octopus?
A: Octopus is an AI-powered code review tool that connects to GitHub, GitLab, Bitbucket, and Forgejo, indexes your codebase for deep context, and automatically reviews every pull request (and GitLab merge request) — posting findings as inline comments with severity levels.

Q: How does the automated review work?
A: When a pull request is opened, Octopus fetches the diff, retrieves relevant context from your indexed codebase using vector search, and sends it to an LLM (Anthropic Claude, OpenAI GPT, Google Gemini, xAI Grok, Alibaba Qwen, or any model on OpenRouter) for analysis. Findings are posted directly on the PR with severity ratings: Critical, Major, Minor, Suggestion, and Tip.

Q: Which programming languages are supported?
A: Octopus is language-agnostic. It reviews any text-based code file — TypeScript, Python, Go, Rust, Java, C#, Ruby, PHP, Swift, Kotlin, and more.

Q: Is my source code safe?
A: Octopus reads repository content to index and review your code. Configured AI services process code and review context. Self-hosting Forgejo does not change this. Self-hosted Octopus with local AI services lets you keep processing on your infrastructure. See the security overview and data-retention documentation for storage details.

Q: Does Octopus replace human reviewers?
A: No. Octopus augments your team's review process. It catches bugs, security issues, and style inconsistencies so your human reviewers can focus on architecture, design decisions, and business logic.

Q: Is there a free tier?
A: Yes! Every organization gets free credits to start. You can also bring your own API keys (Anthropic, OpenAI, Google, Alibaba Cloud Model Studio, Cohere) to avoid credit costs entirely.`,
      },
    ],
  },

  // ─── Getting Started ────────────────────────────────────────────
  {
    page: "getting-started",
    title: "Getting Started with Octopus",
    sections: [
      {
        heading: "What is Octopus?",
        text: `Octopus is an AI-powered code review tool that indexes your entire codebase, learns your patterns and architecture, and reviews every pull request with deep context awareness. It catches real bugs, security issues, and code quality problems before they reach production.
Codebase-Aware: Indexes your code and understands your architecture, not just the diff.
Automatic Reviews: Every PR gets reviewed instantly with severity-rated inline comments.
Works With Your Tools: GitHub, GitLab, Bitbucket, Forgejo, Slack, Linear, Jira. Fits into your existing workflow.`,
      },
      {
        heading: "1. Connect Your Repository",
        text: `Start by connecting your GitHub, GitLab, Bitbucket, or Forgejo account from the dashboard. Octopus uses the GitHub App, GitLab/Bitbucket OAuth, or a Forgejo personal access token to access repositories.
GitHub: Install the GitHub App and select repositories.
GitLab: Connect via OAuth and Octopus automatically manages webhooks for merge requests.
Bitbucket: Connect via OAuth and Octopus automatically manages webhooks.
Forgejo: Choose Cloud + public HTTPS (direct), Cloud + private LAN/VPN (local connector), or self-hosted Octopus + private LAN/VPN (direct). Use the matching personal access token and signed webhook steps at /docs/integrations#forgejo.
For repository readiness, automatic preparation and the first-review milestone, follow /docs/getting-started. For separate authorization, sync and webhook checks and safe recovery, see /docs/integrations#setup-checks.`,
      },
      {
        heading: "2. Your First Review",
        text: `Follow the authoritative first-review instructions at /docs/getting-started and the repository-specific guide at /dashboard.`,
      },
      {
        heading: "3. Understanding Findings",
        text: `Each finding includes a severity level to help you prioritize:
🔴 Critical — Security vulnerabilities, data loss risks, broken functionality. Blocks merge.
🟠 Major — Bugs, logic errors, performance issues, and missing error handling.
🟡 Minor — Code quality, maintainability, and best-practice concerns.
🔵 Suggestion — Optional improvements, alternative approaches, and ideas.
💡 Tip — Informational notes about the code, documentation, or conventions.`,
      },
      {
        heading: "4. Use the CLI",
        text: `Install the Octopus CLI for terminal-based workflows:
curl -fsSL https://octopus-review.ai/install.sh | bash (macOS/Linux) or powershell -c "irm https://octopus-review.ai/install.ps1 | iex" (Windows)
Key commands: octp chat (chat with your codebase), octp review --pr <number> (review a specific PR), octp repo index (re-index a repository), octp knowledge add (add knowledge documents).`,
      },
      {
        heading: "5. Customize Your Setup",
        text: `AI Provider: Choose between Claude (Anthropic), OpenAI, Google Gemini, and Qwen (Alibaba Cloud Model Studio) for reviews and chat. Or bring your own API keys.
Knowledge Base: Upload documents, coding guidelines, and architecture decisions. Octopus references these during reviews.
.octopusignore: Exclude files and directories from indexing and review (same syntax as .gitignore).
Spend Limits: Set monthly spending caps per organization to control costs.
Notifications: Configure Slack and Linear integration for review events.`,
      },
    ],
  },

  // ─── CLI ────────────────────────────────────────────────────────
  {
    page: "cli",
    title: "Octopus CLI Documentation",
    sections: [
      {
        heading: "Installation",
        text: `Install the Octopus CLI globally:
curl -fsSL https://octopus-review.ai/install.sh | bash
Windows: powershell -c "irm https://octopus-review.ai/install.ps1 | iex"
After installing, authenticate with: octp login
Verify your session with: octp whoami`,
      },
      {
        heading: "Repository Commands",
        text: `octp repo list — List all connected repositories.
octp repo status — Show indexing status for a repository.
octp repo index — Re-index the current repository (or specify a repo).
octp repo analyze — Run AI analysis on a repository.
octp chat — Start an interactive chat session about your codebase.`,
      },
      {
        heading: "Pull Request Commands",
        text: `octp review --pr <number> — Review a specific pull request.
You can also pass a full GitHub, GitLab, or Bitbucket PR URL: octp review --pr https://github.com/org/repo/pull/142
For Forgejo, use the PR number from its connected repository checkout; native CLI 0.6.0 does not accept Forgejo full PR URLs.
This requests an asynchronous server-side review for a connected repository. A successful response means queued, not completed. Follow Review Logs and the resulting comments on the PR.
For a staged local diff, use octp review --staged --no-index --format json. It returns findings in the terminal; it does not post PR comments. --no-index prevents new indexing but can still use existing indexed context. Code and review metadata go to Octopus and its configured AI services; credits or provider budget apply. Check truncated in local JSON output before claiming complete coverage.`,
      },
      {
        heading: "Dependency Analysis",
        text: `octp analyze-deps <repo-url> — Analyze dependencies for a repository.
Checks for outdated packages, known vulnerabilities, and license compatibility.`,
      },
      {
        heading: "Knowledge Base",
        text: `octp knowledge list — List all knowledge documents.
octp knowledge add <file> — Add a document to the knowledge base.
octp knowledge remove <id> — Remove a knowledge document.
Knowledge documents are referenced during code reviews for custom rules and guidelines.`,
      },
      {
        heading: "Local Agent",
        text: `octp agent serve — Run the local agent (Ollama LLM tasks + code search).
octp agent watch [path] — Watch a repo directory so cloud chat can search it locally.
The local agent monitors your project and provides real-time assistance.`,
      },
      {
        heading: "Skills",
        text: `octp skills list — List available automation command files.
octp skills install octopus-fix — Install this Claude Code command into the current project's .claude/commands directory.
octp skills install --all — Install all available command files there.
The native CLI does not support --claude or --codex install flags. For Codex, OpenCode, Hermes Agent, OpenClaw, Cursor, or a Claude Code skill, use the shared SKILL.md and per-tool setup at https://octopus-review.ai/docs/cli/ai-agents.`,
      },
      {
        heading: "Configuration",
        text: `octp config list — Show current configuration.
octp config set <key> <value> — Set a configuration value.
octp usage — View token and credit usage.
octp logout — End your session.
Multiple profiles are supported for switching between accounts.`,
      },
    ],
  },

  {
    page: "cli/ai-agents",
    title: "AI Coding Agents",
    sections: [
      {
        heading: "Install the CLI and shared skill",
        text: `Use Octopus with Claude Code, Codex, OpenCode, Hermes Agent by Nous Research, OpenClaw, and Cursor through the native octp CLI and a shared skill. These are CLI/skill setups; do not invent a published Codex, OpenCode, Hermes, or OpenClaw plugin.
Follow https://octopus-review.ai/docs/cli to install and run octp login yourself. Install and authenticate in the environment where the agent actually runs commands, including its remote host, container, sandbox, or node. Ask the agent to run octp --version and octp whoami there and confirm the intended organization. These checks do not start a review. Never paste tokens into chat or skill files.
Download https://octopus-review.ai/skills/octopus/SKILL.md and save it in the location for your tool. This skill is separate from the Claude command files installed by octp skills install. Full guide: https://octopus-review.ai/docs/cli/ai-agents.`,
      },
      {
        heading: "Agent skill locations and activation",
        text: `Claude Code: save .claude/skills/octopus/SKILL.md in the project; start a new session and use /octopus. The separately packaged MCP plugin has its own setup at https://octopus-review.ai/docs/cli/claude-code-integration.
Codex: save .agents/skills/octopus/SKILL.md in the project and invoke $octopus or ask Codex to use the skill.
OpenCode: save .agents/skills/octopus/SKILL.md (or .opencode/skills/octopus/SKILL.md); start in that project and ask it to use the octopus skill.
Hermes Agent by Nous Research: save .agents/skills/octopus/SKILL.md; review the project's skills and run hermes skills trust from its root before starting Hermes. Use /skills to check discovery, then /octopus. The CLI and login must exist inside the configured terminal backend, including Docker or SSH.
OpenClaw: save .agents/skills/octopus/SKILL.md in the configured agent workspace, or skills/octopus/SKILL.md. Run openclaw skills info octopus to check discovery, then use /octopus in a new session. The configured workspace and execution host/node/sandbox may differ from your shell's current checkout.
Cursor: save .agents/skills/octopus/SKILL.md in the project, check Customize > Skills, then use /octopus in Agent chat. Remote agents need their own available CLI and login.
Each tool's ordinary terminal permissions and trust controls still apply.`,
      },
      {
        heading: "Choose the review scope",
        text: `For exactly the staged diff, run octp review --staged --no-index --format json from the intended repository. Untracked files are excluded. Default octp review --no-index --format json can include committed changes since upstream plus unstaged tracked changes, and may omit staged-only changes; inspect the intended scope first. --no-index avoids new repository indexing but can use already indexed context. Local JSON's truncated:true means incomplete coverage.
For a connected repository's PR, octp review --pr 42 (or a full GitHub, GitLab, or Bitbucket PR URL) queues a server-side review. For Forgejo use the PR number from its connected checkout; the native CLI 0.6.0 URL parser does not accept Forgejo PR URLs. Confirm the final result in https://octopus-review.ai/review-logs and on the PR before reporting completion.
Reviews send code/diffs and metadata to the configured Octopus server and AI services and use credits or provider budget, separately from the coding agent subscription. Present findings first; editing files, committing, pushing, and posting comments follow the user's authorization and repository instructions.`,
      },
    ],
  },
  {
    page: "cli/claude-code-integration",
    title: "Claude Code Integration",
    sections: [
      {
        heading: "Install the current Claude plugin",
        text: `The current Octopus MCP plugin is octopus-review in the publisher's octopus-review marketplace. In a terminal run:
claude plugin marketplace add octopusreview/octopus-plugin
claude plugin install octopus-review@octopus-review
Inside Claude Code the equivalents start with /plugin marketplace add and /plugin install. This is the publisher's marketplace, not a claim of inclusion in Anthropic's official catalog. Prerequisites: current Claude Code, Node.js 18 or later with npx, Git, and outbound access to GitHub, the npm registry and Octopus Cloud. The plugin does not need the Octopus CLI. Guide: https://octopus-review.ai/docs/cli/claude-code-integration.`,
      },
      {
        heading: "Configure and verify the Claude plugin",
        text: `Create an organization API token in https://octopus-review.ai/settings/api-tokens. Inside Claude Code run /plugin configure octopus-review@octopus-review and enter it in the sensitive api_token field. Keep tokens out of chat and Git. Restart Claude Code, open /mcp to check that octopus connects, and ask it to call octopus_status without starting a review. Confirm the intended organization.
For tracked working-tree and staged changes, ask the plugin to review the current repository. It uses git diff HEAD; untracked files are excluded, and the Octopus API limit is 500 KiB. The plugin shows brief findings summaries; use the native CLI for structured local review results. Reviews send code to Octopus and configured AI services and use organization credits or provider budget. For a connected repository, asking it to review PR 42 queues a server-side review; verify completion in Review Logs and the PR comments. Type /octopus-review: and select the review command for slash-command use.
Installation and component discovery were checked with Claude Code 2.1.276; this is not evidence of an authenticated customer review. For the native CLI or a configured self-hosted Octopus server, follow https://octopus-review.ai/docs/cli/ai-agents instead.`,
      },
      {
        heading: "Legacy plugin instructions",
        text: `claude plugin install octopus fails in a fresh configuration because its marketplace has not been added. The older octopusreview/claude-plugin repository declares the separate octopus@octopus plugin and still contains instructions calling the obsolete octopus executable. Adding that old marketplace can make installation succeed without making those review commands current. Recommend the current octopus-review@octopus-review plugin or the shared native octp skill. Do not recommend an unqualified /review command or npm @octp/cli as the current native installation.`,
      },
    ],
  },

  // ─── Pricing ────────────────────────────────────────────────────
  {
    page: "pricing",
    title: "Octopus Pricing",
    sections: [
      {
        heading: "Credit System",
        text: `Octopus uses a credit-based pricing system. Credits are consumed when AI operations run: reviews, chat, indexing, and analysis.
Free Tier: Every organization gets free credits to start. No credit card required.
Usage-Based: Pay only for what you use. Purchase credits as needed or set up auto-reload.`,
      },
      {
        heading: "Bring Your Own Keys (BYOK)",
        text: `For supported BYOK providers and which operations consume credits, see the pricing guide: https://octopus-review.ai/docs/pricing.`,
      },
      {
        heading: "Model Pricing",
        text: `Octopus supports models including Claude Fable 5.2, Claude Sonnet 5.5, Claude Opus 5.5 and GPT-6 Astra. For model pricing, the platform rate and prompt-cache discounts, see the pricing guide: https://octopus-review.ai/docs/pricing.`,
      },
      {
        heading: "Spend Limits & Billing",
        text: `Set monthly spend limits per organization to prevent unexpected costs.
Track usage in the billing dashboard: see token consumption, credit balance, and cost breakdown by operation (review, chat, indexing, analysis).
Credits can be purchased, and auto-reload ensures you never run out mid-review.
Self-hosting: No credits needed. Use your own API keys directly.`,
      },
    ],
  },

  // ─── Integrations ───────────────────────────────────────────────
  {
    page: "integrations",
    title: "Octopus Integrations",
    sections: [
      {
        heading: "GitHub",
        text: `Install the Octopus GitHub App on your repositories.
Features: Automatic PR reviews via webhook, inline comments on PR diffs, check runs for CI integration, issue creation from findings.
Permissions required: Read access to code, PRs, and metadata. Write access for comments and check runs.`,
      },
      {
        heading: "GitLab",
        text: `Connect GitLab via OAuth from the Octopus dashboard. Supports GitLab.com and self-managed GitLab instances.
Features: Automatic merge request reviews via webhook, inline comments on MR diffs, automatic webhook management.
Authentication uses OAuth Bearer tokens; clone is handled via the GitLab API so private repositories work without SSH keys.`,
      },
      {
        heading: "Bitbucket",
        text: `Connect Bitbucket via OAuth from the Octopus dashboard.
Features: PR reviews via webhook, inline comments, automatic webhook management.
Workspace webhook setup checks and recovery, including existing hooks with ambiguous ownership: /docs/integrations#setup-checks.`,
      },
      {
        heading: "Forgejo connection options",
        text: `Choose one of three setups at /docs/integrations#forgejo:
1. Octopus Cloud + public HTTPS: direct connection with a personal access token stored encrypted in Octopus. /docs/integrations#forgejo-cloud-public.
2. Octopus Cloud + private LAN/VPN: run the local outbound connector on a machine with private Forgejo access. Forgejo stays private; its personal access token stays on the connector machine. Both the connector and Forgejo need outbound HTTPS to octopus-review.ai on port 443. The connector handles API requests, and Forgejo sends signed webhooks directly to Cloud. No public Forgejo address, tunnel or connector inbound port is needed. Code and review context still reach Cloud and the configured AI services. /docs/integrations#forgejo-cloud-private.
3. Self-hosted Octopus + private LAN/VPN: connect directly from your own Octopus web application and review workers. In Settings > Integrations > Forgejo, enter the HTTPS origin and personal access token, then click Connect Forgejo to connect and sync repositories. Both need network/DNS access and FORGEJO_ALLOWED_PRIVATE_ORIGINS with exact HTTPS origins; see /docs/self-hosting#forgejo. No connector is required.
All modes use a dedicated Forgejo account with repository admin access, not instance administrator access. Token scopes: read:user, write:repository, write:issue. For private repositories choose All (public, private, and limited), limiting repository access through the bot account. Specific repositories tokens cannot include read:user. One Forgejo instance per Octopus organization; only repositories administered by the account sync. Configure signed webhooks using the URL and secret in Settings. In Forgejo choose Trigger on > Custom events… > Pull request events, then Modification and Synchronized. Select Comments in that same group for @octopus or /octopus PR commands, keep Active checked and save. Token, webhook and automatic/manual event details: /docs/integrations#forgejo. Native CLI agent setup remains GitHub-only.`,
      },
      {
        heading: "Forgejo private connector setup",
        text: `The Forgejo connector is a small Docker container you run on a machine with access to your private Forgejo instance. Docker downloads it automatically when you run the setup command; no separate installer is needed. Install Docker at https://docs.docker.com/get-started/get-docker/. The published connector image is ghcr.io/octopusreview/octopus-selfhost:forgejo-connector-1.2.0, available at https://github.com/orgs/octopusreview/packages/container/octopus-selfhost/1269975499.
1. In your dedicated Forgejo account, open Settings > Applications and create a personal access token with read:user, write:repository and write:issue, choosing All (public, private, and limited). Keep this separate token on your connector machine as FORGEJO_TOKEN. Give the account admin access only to the intended repositories; instance administrator access is unnecessary.
2. As an Octopus organization owner or admin, open /settings/integrations#forgejo in Octopus Cloud. Choose Private network connector, enter the exact HTTPS Forgejo origin and click Create connector, then Copy connector token. Save this one-time token as OCTOPUS_CONNECTOR_TOKEN.
3. On that machine, create a protected connector.env file with OCTOPUS_URL=https://octopus-review.ai, OCTOPUS_CONNECTOR_TOKEN, FORGEJO_URL and FORGEJO_TOKEN (chmod 600). Start the connector with docker run using --env-file connector.env, --restart unless-stopped, --stop-timeout 120 and --read-only; publish no ports. Copyable commands: /docs/integrations#forgejo-cloud-private. Container DNS/VPN routes must reach Forgejo, not just the host browser. Verified HTTPS is required; localhost, loopback, link-local, metadata addresses, redirects and HTTP are blocked. For an internal CA, set NODE_EXTRA_CA_CERTS to a mounted trusted PEM file and keep certificate verification enabled.
4. Return to Octopus Settings > Integrations > Forgejo, click Refresh status and wait for Connector online, then click Sync repositories.
5. In each Forgejo repository, open Settings > Webhooks > Add Webhook > Forgejo. Copy Target URL and Webhook secret from Octopus; use POST and application/json. Under Trigger on choose Custom events… > Pull request events, selecting Modification and Synchronized. Also select Comments in that same group for PR commands. Keep Active checked and save the webhook. Forgejo sends these webhooks directly to Octopus Cloud.
6. Follow /docs/integrations#forgejo-cloud-private for repository readiness and your first PR, with automatic preparation. Keep the connector running for indexing and reviews.
Rotating the connector credential invalidates the old one; update the local configuration and restart. Docker users must recreate the container with the env file; docker restart does not reload it. An uncertain write result pauses the connector; inspect Forgejo before selecting Resume after checking Forgejo. The uncertain write is not automatically replayed. Consumed response payloads are cleared immediately; payload-free publication recovery metadata stays until acknowledgement, with renewable 60-second leases capped at two hours. Failed or expired metadata is eligible for deletion after five minutes; the reconciliation hold remains until an administrator resumes the connector. Disconnecting deactivates repositories. Remove webhooks and revoke the Forgejo token too. This connection needs internet access and does not keep Cloud review processing on your network. Full setup: /docs/integrations#forgejo-cloud-private.`,
      },
      {
        heading: "Jira",
        text: `Connect Jira to create issues directly from review findings.
When Octopus surfaces a critical bug or security finding, you can open a Jira issue in one click. The issue is pre-filled with the finding details, severity, PR/MR link, and file location. Configure the target project and default issue type from the integration settings.`,
      },
      {
        heading: "Linear",
        text: `Connect Linear to create issues directly from review findings.
When Octopus finds a critical bug or security issue, you can create a Linear issue with one click. The issue includes the finding details, severity, and file location.`,
      },
      {
        heading: "Slack",
        text: `Use the /octopus slash command in Slack to ask questions about your codebase.
Octopus responds with context-aware answers, complete with file citations.
Event notifications: Receive Slack messages when reviews complete, repos are indexed, or issues are found. Supported events: review-requested, review-completed, review-failed, repo-indexed, repo-analyzed, knowledge-ready.`,
      },
    ],
  },

  // ─── Self-Hosting ───────────────────────────────────────────────
  {
    page: "self-hosting",
    title: "Self-Hosting Octopus",
    sections: [
      {
        heading: "Prerequisites",
        text: `To self-host Octopus you need:
PostgreSQL 15 or higher for the database.
Qdrant for vector storage (embeddings and semantic search).
Node.js 20+ or Bun runtime.
OpenAI API key for embeddings (text-embedding-3-large).
Anthropic API key for Claude (reviews and chat).`,
      },
      {
        heading: "Quick Start with Docker",
        text: `1. Clone the repository: git clone https://github.com/octopusreview/octopus.git
2. Create a .env file with your configuration (an auto-generator is provided on the docs page). Pin OCTOPUS_VERSION to the release tag you want to run.
3. Pull the prebuilt self-host image: docker compose -f docker-compose.selfhost.yml pull
4. Start the stack: docker compose -f docker-compose.selfhost.yml up -d
5. Run database migrations from a repo checkout matching OCTOPUS_VERSION (the runtime image does not ship the Prisma CLI or migration files): cd packages/db && DATABASE_URL=postgresql://octopus:octopus@localhost:43332/octopus bunx prisma migrate deploy
6. Access Octopus at http://localhost:43300 (set OCTOPUS_PORT to override the default 43300).
The self-host compose file includes PostgreSQL and Qdrant containers.`,
      },
      {
        heading: "Environment Variables",
        text: `Configure DATABASE_URL, QDRANT_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, and your embedding/review AI services. GitHub App credentials are needed only when connecting GitHub repositories. For a direct Forgejo connection, enter the instance URL and token in Settings > Integrations and add repository webhooks. Self-hosted Octopus can reach private Forgejo through FORGEJO_ALLOWED_PRIVATE_ORIGINS configured on both web and review workers. Cloud users with private Forgejo instead use the local connector described at /docs/integrations#forgejo-cloud-private.
Optional: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (for GitHub login), COHERE_API_KEY (for re-ranking), GOOGLE_API_KEY (Gemini models), STRIPE_SECRET_KEY (for billing).
The self-hosting docs page includes an interactive env generator.`,
      },
      {
        heading: "GitHub App Setup",
        text: `Create a GitHub App for your self-hosted instance:
Set the webhook URL to your instance's /api/github/webhook endpoint.
Required permissions: Contents (read), Pull requests (read/write), Checks (read/write), Metadata (read).
Subscribe to events: Pull request, Pull request review.`,
      },
      {
        heading: "Production Tips",
        text: `Use connection pooling (PgBouncer) for PostgreSQL in production.
Secure Qdrant with API key authentication.
Set spend limits per organization.
Use HTTPS with a reverse proxy (nginx, Caddy).
Running without Docker: Install Bun, set up PostgreSQL and Qdrant locally, run bun install and bun run dev.`,
      },
    ],
  },

  // ─── FAQ ────────────────────────────────────────────────────────
  {
    page: "faq",
    title: "Octopus FAQ",
    sections: [
      {
        heading: "General",
        text: `Q: What is Octopus?
A: Octopus is a source-available, AI-powered code review tool that indexes your codebase and automatically reviews pull requests with context-aware findings.

Q: How does Octopus review code?
A: When a PR is opened, Octopus fetches the diff, retrieves relevant code context via vector search, and uses an LLM (Anthropic Claude, OpenAI GPT, Google Gemini, xAI Grok, Alibaba Qwen, or any model on OpenRouter) to analyze changes. Findings are posted as inline PR comments.

Q: What languages does Octopus support?
A: Octopus is language-agnostic. It supports TypeScript, JavaScript, Python, Go, Rust, Java, C#, Ruby, PHP, Swift, Kotlin, Scala, C, C++, Vue, Svelte, Astro, HTML, CSS, SQL, GraphQL, and more.

Q: How is Octopus different from human reviewers?
A: Octopus augments human review. It catches bugs, security issues, and style problems so humans can focus on architecture and design.

Q: How is Octopus different from linters?
A: Linters check syntax and formatting rules. Octopus understands your entire codebase context, catches logic errors, security vulnerabilities, and provides architectural feedback.`,
      },
      {
        heading: "Security & Privacy",
        text: `Q: Is my code safe?
A: Octopus reads repository content for indexing and reviews, and configured AI services process code and review context. This also applies to self-hosted Forgejo connected to Octopus Cloud. See the security overview and data-retention documentation for storage details.

Q: Can I self-host Octopus?
A: Yes. Octopus is fully self-hostable with Docker. External AI services still receive code when configured. Use local services for processing that must stay on your infrastructure.

Q: Which AI models are used?
A: Claude (Anthropic), OpenAI (GPT), Google Gemini, and Qwen (Alibaba Cloud Model Studio) are all supported review/chat models, selectable per organization — and you can bring your own key for any of them (a Google Gemini API key works for reviews, not just embeddings). OpenAI text-embedding-3-large is used for embeddings. Cohere Rerank is used for search re-ranking.

Q: Is my code used for AI training?
A: Octopus sends code to configured AI services for indexing and reviews. Check each service's current terms and account settings for its data-use policy. Use local services when external processing is not permitted.`,
      },
      {
        heading: "Integrations",
        text: `Q: Which Git platforms are supported?
A: GitHub, GitLab, Bitbucket, and Forgejo. GitLab supports both GitLab.com and self-managed instances. Forgejo supports Cloud + public HTTPS (direct), Cloud + private LAN/VPN (local connector), or self-hosted Octopus + private LAN/VPN (direct). All use an HTTPS instance, a personal access token and signed repository webhooks. See /docs/integrations#forgejo.

Q: Does Octopus work with Slack?
A: Yes. Use the /octopus command to ask questions about your codebase. You also receive notifications for review events.

Q: Does Octopus integrate with Linear?
A: Yes. Create Linear issues directly from review findings with one click.

Q: Does Octopus integrate with Jira?
A: Yes. Create Jira issues directly from review findings with one click. The issue includes finding details, severity, and a link back to the PR/MR.

Q: Does Octopus support monorepos?
A: Yes. Octopus indexes the entire repository including all packages in a monorepo.

Q: Is there a CLI?
A: Yes. Install with curl -fsSL https://octopus-review.ai/install.sh | bash. Use it to review PRs, chat with your codebase, and manage knowledge.`,
      },
      {
        heading: "Pricing & Billing",
        text: `Q: How does pricing work?
A: Credit-based. AI operations consume credits. Free credits included. Buy more as needed.

Q: Is there a free tier?
A: Yes. Every organization gets free credits. No credit card required.

Q: Can I use my own API keys?
A: Yes. See the pricing guide for BYOK coverage and credit charges: https://octopus-review.ai/docs/pricing.

Q: How do spend limits work?
A: Set a monthly cap per organization. Operations are paused when the limit is reached.`,
      },
      {
        heading: "Technical",
        text: `Q: How does codebase indexing work?
A: Octopus clones your repo, chunks code files into 1500-character segments with 200-character overlap, creates embeddings using text-embedding-3-large, and stores them in Qdrant for vector search.

Q: What is the Knowledge Base?
A: A collection of custom documents (guidelines, architecture decisions, coding standards) that Octopus references during reviews to enforce your team's specific rules.

Q: How long does a review take?
A: Most reviews complete in under 2 minutes, depending on the size of the diff and the amount of context retrieved.

Q: Can I customize reviews?
A: Yes. Upload knowledge documents, configure .octopusignore to exclude files, choose your AI provider, and set severity thresholds.

Q: How do real-time updates work?
A: Octopus uses WebSocket connections (via Pubby SDK) to push real-time updates: review progress, chat messages, indexing status, and team activity.`,
      },
    ],
  },

  // ─── Glossary ───────────────────────────────────────────────────
  {
    page: "glossary",
    title: "Octopus Glossary",
    sections: [
      {
        heading: "Terms",
        text: `BYO Keys (Bring Your Own Keys): Use your own API keys for Anthropic, OpenAI, Google, Alibaba Cloud Model Studio, or Cohere instead of Octopus credits. Configure in organization settings.

Codebase Indexing: The process of cloning a repository, splitting code into chunks, creating vector embeddings, and storing them in Qdrant for semantic search.

Context Window: The maximum amount of text an LLM can process in a single request. Octopus manages context by retrieving only the most relevant code chunks via vector search.

Credits: The unit of currency in Octopus. AI operations (reviews, chat, indexing) consume credits. Free credits are provided; additional credits can be purchased.

Diff: The set of changes in a pull request — lines added, modified, or removed. Octopus analyzes the diff against full codebase context.

Embeddings: Numerical vector representations of text. Octopus uses OpenAI text-embedding-3-large (3072 dimensions) to create embeddings of code chunks for semantic search.

Knowledge Base: Custom documents uploaded to an organization (coding guidelines, architecture decisions, style guides) that Octopus references during reviews.

LLM (Large Language Model): AI models like Claude (Anthropic), GPT (OpenAI), Gemini (Google), Grok (xAI) and Qwen (Alibaba) that analyze code and generate review findings.

.octopusignore: A file in your repository root (same syntax as .gitignore) that tells Octopus which files to skip during indexing and review.

Qdrant: The vector database used by Octopus to store and search code embeddings. Collections: code_chunks, knowledge_chunks, review_chunks, chat_chunks, flowchart_chunks.

Reranking: A second-pass ranking step using Cohere Rerank that re-orders search results by relevance to the query, improving the quality of retrieved context.

Severity Levels: Finding priority ratings — 🔴 Critical (security, data loss, or broken functionality; blocks merge), 🟠 Major (bugs, logic errors, performance), 🟡 Minor (code quality, maintainability), 🔵 Suggestion (optional improvement), 💡 Tip (informational).

Spend Limit: A monthly cost cap per organization. When reached, AI operations are paused until the next billing cycle or limit increase.

Vector Search: Semantic search using embeddings. Instead of keyword matching, vector search finds code that is semantically similar to the query, even with different wording.

Webhook: An HTTP callback from GitHub, GitLab, Bitbucket, or Forgejo that notifies Octopus when events occur (PR/MR opened, PR/MR updated, push). This triggers automatic reviews.`,
      },
    ],
  },

  // ─── Skills ─────────────────────────────────────────────────────
  {
    page: "skills",
    title: "Octopus Skills",
    sections: [
      {
        heading: "Overview",
        text: `The downloadable workflow command files on /docs/skills target Claude Code. The native CLI installs them under the project's .claude/commands directory, not as Codex plugins. For a shared Octopus review skill covering Claude Code, Codex, OpenCode, Hermes Agent, OpenClaw and Cursor, follow https://octopus-review.ai/docs/cli/ai-agents and download /skills/octopus/SKILL.md.
Features: Smart categorization of changes, automatic PR creation, full traceability from issue to PR.`,
      },
      {
        heading: "Split and Ship",
        text: `The Split and Ship skill analyzes your working directory, categorizes changes into logical groups, creates GitHub issues for each group, and ships individual PRs.
Workflow: 1) Analyze git status 2) Categorize changes by type (feat, fix, refactor, chore, docs) 3) Create GitHub issues 4) Create branches and PRs 5) Report summary.
Branch naming convention: <type>/<description> (e.g., feat/add-user-auth, fix/null-pointer-error).
Rules: Each file belongs to exactly one category. User confirms before proceeding. Every PR closes its corresponding issue.`,
      },
      {
        heading: "Octopus Fix",
        text: `The Octopus Fix skill discovers open PRs with review comments, presents a summary, and applies fixes.
Workflow: 1) Discover open PRs 2) Check reviews (fetch comments/threads; automatically skip PRs whose latest bot review shows 0 findings) 3) Present summary and get confirmation 4) Apply fixes (checkout branch, minimal changes, commit, push) 5) Report.
Review handling: Thumbs up for valid suggestions (fixed with a reply describing the change), thumbs down for false positives (with an explanation). Review threads are resolved after fixes, and a final PR comment tags @octopusreview to signal updates are ready.
Rules: Never force-push. Show proposed fixes and get confirmation before committing. Make minimal changes. Ask on unclear comments. Stop on merge conflicts. Preserve git history — no squash, rebase, or amend.`,
      },
      {
        heading: "Octopus Changelog",
        text: `The Octopus Changelog skill reads your git history since the last tag, categorizes commits using the Keep a Changelog standard, and updates CHANGELOG.md for a new release.
Workflow: 1) Determine version (detect the latest git tag and suggest the next, or use the version you provide) 2) Gather commits since the last tag and parse conventional-commit prefixes 3) Categorize into Added, Fixed, Changed, Removed, Deprecated, Security (skipping dependency bumps and trivial changes) 4) Review draft — present the formatted entries for approval 5) Update file — insert the new version section into CHANGELOG.md with comparison links.
Rules: Never commits or pushes — only updates the file. Always shows a draft and gets confirmation before writing. Skips dependency bumps, trivial refactors, and CI-only changes. Groups related commits into single entries.`,
      },
    ],
  },

  // ─── About ──────────────────────────────────────────────────────
  {
    page: "about",
    title: "About Octopus",
    sections: [
      {
        heading: "Why Octopus",
        text: `Octopus was built out of frustration with slow PR reviews. Waiting hours or days for review feedback slows down the entire team. AI can provide instant, context-aware feedback on every PR.
Octopus is not a toy — it's a serious tool built by an independent developer who cares about code quality and developer experience.`,
      },
      {
        heading: "Source-Available Principles",
        text: `Transparency: The full source is available. You can read, audit, and understand exactly how your code is processed.
No vendor lock-in: Self-host on your own infrastructure. Bring your own API keys.
Community driven: Contributions are welcome. Open issues, submit PRs, and help shape the future.
Free to self-host: run the source-available core on your own infrastructure at no cost. The managed cloud is a paid, credit-based service with free credits to start.`,
      },
      {
        heading: "Tech Stack",
        text: `Next.js (App Router, React 19) for the web application.
Prisma with PostgreSQL for the database.
Qdrant for vector storage and semantic search.
Claude (Anthropic), OpenAI, and Google Gemini for AI operations.
Tailwind CSS 4 for styling.
TypeScript throughout.
Turborepo for monorepo management.`,
      },
      {
        heading: "Future Direction",
        text: `More Git provider integrations beyond the current GitHub, GitLab, Bitbucket, and Forgejo support.
Smarter review engine with better context retrieval.
Expanded CLI capabilities.
Plugin system for custom review rules and integrations.`,
      },
    ],
  },

  // ─── .octopusignore ─────────────────────────────────────────────
  {
    page: "octopusignore",
    title: ".octopusignore Configuration",
    sections: [
      {
        heading: "Overview",
        text: `.octopusignore is a file in your repository root that tells Octopus which files and directories to skip during indexing and review. It uses the same syntax as .gitignore.`,
      },
      {
        heading: "Syntax",
        text: `Wildcards: *.min.js, *.generated.ts
Directory patterns: dist/, node_modules/, .next/
Negation: !important-config.js (force include a file that would otherwise be ignored)
Comments: Lines starting with # are ignored.`,
      },
      {
        heading: "How It Works",
        text: `During indexing: Files matching .octopusignore patterns are skipped. They are not chunked or embedded.
During review: Diffs for ignored files are removed from the review context. The AI won't comment on ignored files.
Octopus also auto-detects common build artifacts (node_modules/, .next/, dist/, build/, vendor/, __pycache__/).`,
      },
      {
        heading: "Common Patterns",
        text: `Monorepo: packages/*/dist/, packages/*/node_modules/
Frontend: public/assets/, *.min.js, *.min.css, *.map
Data/ML: *.csv, *.parquet, data/, models/, checkpoints/
General: *.lock, *.log, .env*, coverage/, .turbo/`,
      },
    ],
  },
];
