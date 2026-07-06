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
        text: `Step 1: Connect GitHub — Install the Octopus GitHub App on your repositories. Select which repos to monitor. GitLab and Bitbucket are also supported via OAuth.
Step 2: AI Learns Your Code — Octopus indexes your codebase, creating vector embeddings of your code chunks. It understands your architecture, patterns, and conventions.
Step 3: Reviews on Autopilot — Every pull request is automatically reviewed. Octopus posts findings as inline comments with severity levels: Critical, Major, Minor, Suggestion, and Tip.`,
      },
      {
        heading: "Cloud or Self-Host",
        text: `Two ways to run Octopus. Cloud (recommended): a fully managed service — nothing to run or maintain. Auto-reviews every PR via the GitHub App, free credits to start with usage-based pricing after (no card required), managed updates, backups, and scaling, and your code is never stored long-term or used for training. Self-host: run the entire platform on your own infrastructure with one Docker Compose file — free and source-available (Modified MIT License), your code never leaves your network, and you can bring your own AI keys or run local models.`,
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
Self-Host Ready — Run Octopus on your own infrastructure with one Docker Compose file. Your code never leaves your servers. Bring your own AI keys or run local models.`,
      },
      {
        heading: "FAQ",
        text: `Q: What is Octopus?
A: Octopus is an AI-powered code review tool that connects to GitHub, GitLab, and Bitbucket, indexes your codebase for deep context, and automatically reviews every pull request (and GitLab merge request) — posting findings as inline comments with severity levels.

Q: How does the automated review work?
A: When a pull request is opened, Octopus fetches the diff, retrieves relevant context from your indexed codebase using vector search, and sends it to an LLM (Claude, OpenAI, or Google Gemini) for analysis. Findings are posted directly on the PR with severity ratings: Critical, Major, Minor, Suggestion, and Tip.

Q: Which programming languages are supported?
A: Octopus is language-agnostic. It reviews any text-based code file — TypeScript, Python, Go, Rust, Java, C#, Ruby, PHP, Swift, Kotlin, and more.

Q: Is my source code safe?
A: Yes. Your code is processed in-memory and never stored permanently. Only vector embeddings are persisted for search. You can also self-host Octopus.

Q: Does Octopus replace human reviewers?
A: No. Octopus augments your team's review process. It catches bugs, security issues, and style inconsistencies so your human reviewers can focus on architecture, design decisions, and business logic.

Q: Is there a free tier?
A: Yes! Every organization gets free credits to start. You can also bring your own API keys (Anthropic, OpenAI, Google, Cohere) to avoid credit costs entirely.`,
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
Works With Your Tools: GitHub, GitLab, Bitbucket, Slack, Linear, Jira. Fits into your existing workflow.`,
      },
      {
        heading: "1. Connect Your Repository",
        text: `Start by connecting your GitHub, GitLab, or Bitbucket account from the dashboard. Octopus installs as a GitHub App or sets up GitLab/Bitbucket OAuth to receive webhook events from your repositories.
GitHub: Install the GitHub App, select repositories, and you're ready to go.
GitLab: Connect via OAuth and Octopus automatically manages webhooks for merge requests.
Bitbucket: Connect via OAuth and Octopus automatically manages webhooks.
Once connected, Octopus indexes your codebase. It chunks your code, creates embeddings, and builds a searchable representation of your entire project.`,
      },
      {
        heading: "2. Your First Review",
        text: `Open a pull request on any connected repository. Octopus automatically picks it up via webhook, analyzes the diff against your full codebase context, and posts findings as inline comments.
The review pipeline: Webhook receives PR event → Octopus fetches the diff → AI analyzes changes with codebase context → Findings posted as inline PR comments.`,
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
        text: `AI Provider: Choose between Claude (Anthropic), OpenAI, and Google Gemini for reviews and chat. Or bring your own API keys.
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
You can also pass a full PR URL: octp review --pr https://github.com/org/repo/pull/142
The CLI streams the review in real-time and posts findings to the PR.`,
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
        text: `octp skills list — List available automation skills.
octp skills install <name> — Install a skill for Claude Code or Codex.
Skills are pre-built automation workflows like "Split and Ship" and "Octopus Fix".`,
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
        text: `You can bring your own API keys for Anthropic (Claude), OpenAI, Google, and Cohere. When using your own keys, AI operations don't consume Octopus credits — you pay the providers directly at their rates.
This is ideal for teams that already have API agreements with AI providers or want full control over costs.`,
      },
      {
        heading: "Model Pricing",
        text: `Octopus supports multiple AI models. A 20% platform fee is applied on top of provider costs. Base prices per 1M tokens:
Claude Opus 4.6 and Claude Opus 4 — $15 input / $75 output. Highest-quality review models.
Claude Sonnet 4.6 and Claude Sonnet 4 — $3 input / $15 output. Primary review models: high quality, fast.
Claude Haiku 4.5 — $1 input / $5 output. Lightweight tasks like title generation.
Gemini 2.5 Pro — $1.25 input / $10 output. Gemini 2.5 Flash — $0.15 input / $0.60 output.
GPT-5.3 Codex — $1.75 input / $14 output.
Embeddings: text-embedding-3-large ($0.13) and text-embedding-3-small ($0.02).
Cohere rerank is used for re-ranking search results.
Prompt caching reduces costs: cached reads are billed at 10% of the input price.`,
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
Octopus manages the webhook lifecycle — no manual setup needed.`,
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
        text: `Required: DATABASE_URL, QDRANT_URL, OPENAI_API_KEY, ANTHROPIC_API_KEY, BETTER_AUTH_SECRET, BETTER_AUTH_URL, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET.
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
A: When a PR is opened, Octopus fetches the diff, retrieves relevant code context via vector search, and uses an LLM (Claude, OpenAI, or Google Gemini) to analyze changes. Findings are posted as inline PR comments.

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
A: Your code is processed in-memory and never stored permanently. Only vector embeddings are persisted.

Q: Can I self-host Octopus?
A: Yes. Octopus is fully self-hostable with Docker. Your code never leaves your infrastructure.

Q: Which AI models are used?
A: Claude (Anthropic), OpenAI (GPT), and Google Gemini are all supported review/chat models, selectable per organization — and you can bring your own key for any of them (a Google Gemini API key works for reviews, not just embeddings). OpenAI text-embedding-3-large is used for embeddings. Cohere Rerank is used for search re-ranking.

Q: Is my code used for AI training?
A: No. Anthropic, OpenAI, and Google do not use API inputs to train their models. Your code is never used to train AI models.`,
      },
      {
        heading: "Integrations",
        text: `Q: Which Git platforms are supported?
A: GitHub, GitLab, and Bitbucket. GitLab supports both GitLab.com and self-managed instances.

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
A: Yes. Bring Your Own Keys (BYOK) for Anthropic, OpenAI, Google, and Cohere. No credits consumed.

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
        text: `BYO Keys (Bring Your Own Keys): Use your own API keys for Anthropic, OpenAI, Google, or Cohere instead of Octopus credits. Configure in organization settings.

Codebase Indexing: The process of cloning a repository, splitting code into chunks, creating vector embeddings, and storing them in Qdrant for semantic search.

Context Window: The maximum amount of text an LLM can process in a single request. Octopus manages context by retrieving only the most relevant code chunks via vector search.

Credits: The unit of currency in Octopus. AI operations (reviews, chat, indexing) consume credits. Free credits are provided; additional credits can be purchased.

Diff: The set of changes in a pull request — lines added, modified, or removed. Octopus analyzes the diff against full codebase context.

Embeddings: Numerical vector representations of text. Octopus uses OpenAI text-embedding-3-large (3072 dimensions) to create embeddings of code chunks for semantic search.

Knowledge Base: Custom documents uploaded to an organization (coding guidelines, architecture decisions, style guides) that Octopus references during reviews.

LLM (Large Language Model): AI models like Claude (Anthropic), GPT (OpenAI), and Gemini (Google) that analyze code and generate review findings.

.octopusignore: A file in your repository root (same syntax as .gitignore) that tells Octopus which files to skip during indexing and review.

Qdrant: The vector database used by Octopus to store and search code embeddings. Collections: code_chunks, knowledge_chunks, review_chunks, chat_chunks, flowchart_chunks.

Reranking: A second-pass ranking step using Cohere Rerank that re-orders search results by relevance to the query, improving the quality of retrieved context.

Severity Levels: Finding priority ratings — 🔴 Critical (security, data loss, or broken functionality; blocks merge), 🟠 Major (bugs, logic errors, performance), 🟡 Minor (code quality, maintainability), 🔵 Suggestion (optional improvement), 💡 Tip (informational).

Spend Limit: A monthly cost cap per organization. When reached, AI operations are paused until the next billing cycle or limit increase.

Vector Search: Semantic search using embeddings. Instead of keyword matching, vector search finds code that is semantically similar to the query, even with different wording.

Webhook: An HTTP callback from GitHub, GitLab, or Bitbucket that notifies Octopus when events occur (PR/MR opened, PR/MR updated, push). This triggers automatic reviews.`,
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
        text: `Skills are pre-built automation workflows that you can install and run with Claude Code or Codex. They automate common development tasks using Octopus as the backbone.
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
        text: `More Git provider integrations beyond the current GitHub, GitLab, and Bitbucket support.
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
