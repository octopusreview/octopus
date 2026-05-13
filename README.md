<p align="center">
  <img width="157" height="58" alt="image" src="https://github.com/user-attachments/assets/1b786c2d-7910-4f07-8868-6403166ffa6f" />
</p>

<p align="center">
  <a href="https://github.com/octopusreview/octopus/actions/workflows/ci.yml"><img src="https://github.com/octopusreview/octopus/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/octopusreview/octopus/actions/workflows/dependabot/dependabot-updates"><img src="https://github.com/octopusreview/octopus/actions/workflows/dependabot/dependabot-updates/badge.svg" alt="Dependabot Updates" /></a>
  <a href="https://github.com/octopusreview/octopus/actions/workflows/github-code-scanning/codeql"><img src="https://github.com/octopusreview/octopus/actions/workflows/github-code-scanning/codeql/badge.svg" alt="CodeQL" /></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/License-Modified%20MIT-blue.svg" alt="License: Modified MIT" /></a>
  <a href="https://github.com/octopusreview/octopus/discussions"><img src="https://img.shields.io/github/discussions/octopusreview/octopus" alt="GitHub Discussions" /></a>
</p>

<p align="center">
  <a href="https://x.com/octopus_review"><img src="https://img.shields.io/badge/@octopus__review-212429?logo=x&logoColor=white" alt="X (Twitter)" /></a>
  <a href="https://discord.gg/qyuWTXghbS"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://www.youtube.com/@OctopusReview"><img src="https://img.shields.io/badge/YouTube-@OctopusReview-FF0000?logo=youtube&logoColor=white" alt="YouTube" /></a>
  <a href="https://www.linkedin.com/company/octopus-review"><img src="https://img.shields.io/badge/LinkedIn-Octopus%20Review-0A66C2?logo=linkedin&logoColor=white" alt="LinkedIn" /></a>
</p>

# Octopus

AI-powered PR review tool. Multi-armed code analysis — no bug escapes.

Octopus analyzes pull and merge requests via GitHub, GitLab, and Bitbucket webhooks, creates code embeddings with vector search, reviews changes using Claude or OpenAI, and posts findings as inline comments with severity levels.

## Features

- **Automated PR & MR Reviews** — AI-powered code review with severity indicators (🔴 Critical, 🟠 Major, 🟡 Minor, 🔵 Info, 💡 Suggestion)
- **Codebase Indexing** — Chunks and embeds your code into Qdrant for context-aware reviews
- **Multi-Provider AI** — Claude (Anthropic), OpenAI, Google, and Cohere models per organization, with Bring Your Own Keys (BYOK)
- **GitHub, GitLab & Bitbucket** — Native webhook integrations across all three platforms, including self-managed GitLab
- **Knowledge Center** — Org-level knowledge plus pinned documents that are always included in every review
- **Repo Config Files** — Honor `.octopus.md`, `AGENTS.md`, or `CLAUDE.md` as repo-scoped review rules, extracted in a sandboxed pass
- **Slack Integration** — Ask questions about your codebase directly from Slack
- **Linear & Jira Integration** — Create issues from review findings with one click
- **CLI** — `@octp/cli` for local review runs, plus a Claude Code skill for terminal workflows
- **Review Output Language** — Org-level setting for the prose language of summaries and findings (code stays in source language)
- **Repository Graph** — Structural and semantic edges across your codebase
- **Real-time Updates** — Live dashboard updates via WebSocket (Pubby)
- **Usage & Cost Tracking** — Per-org token usage tracking with monthly spend limits
- **Team Management** — Multi-org support with role-based access
- **Free for Open Source** — Public OSS repositories get free reviews via a separate community pipeline

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Next.js 16](https://nextjs.org) (App Router, React 19)
- **Styling:** [Tailwind CSS 4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)
- **Database:** PostgreSQL with [Prisma](https://prisma.io)
- **Vector Store:** [Qdrant](https://qdrant.tech)
- **Auth:** [Better Auth](https://www.better-auth.com) (Google, GitHub OAuth, Magic Link)
- **Monorepo:** [Turborepo](https://turbo.build)

## Project Structure

```
octopus/
├── apps/
│   └── web/              # Next.js web application
├── packages/
│   └── db/               # Prisma schema & shared DB client
└── tools/
    ├── tsconfig/         # Shared TypeScript configs
    └── eslint-config/    # Shared ESLint config
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.3.4+)
- PostgreSQL
- [Qdrant](https://qdrant.tech) instance
- API keys for Claude (Anthropic) and/or OpenAI

### Installation

```bash
# Clone the repository
git clone https://github.com/octopusreview/octopus.git
cd octopus

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Generate Prisma client
bun run db:generate

# Run database migrations
bun run db:migrate

# Start the development server
bun run dev
```

## Commands

```bash
bun install              # Install dependencies
bun run dev              # Start all apps (Turborepo)
bun run build            # Build all packages
bun run lint             # Lint all packages
bun run typecheck        # Type-check all packages

# Database
bun run db:generate      # Generate Prisma client
bun run db:migrate       # Run migrations (dev)
bun run db:push          # Push schema to DB (no migration)
bun run db:studio        # Open Prisma Studio
```

## Self-Hosting with Docker

```bash
# Clone and configure
git clone https://github.com/octopusreview/octopus.git
cd octopus
cp .env.example .env
# Edit .env with your API keys and configuration

# Start all services (PostgreSQL, Qdrant, Web)
docker compose up -d

# Run database migrations
docker compose exec web bunx prisma migrate deploy
```

Octopus will be available at `http://localhost:43300`.

See [docker-compose.yml](docker-compose.yml) for service configuration.

## How It Works

1. **Webhook** — GitHub, GitLab, or Bitbucket sends a PR/MR event to Octopus
2. **Index** — Octopus clones the repo, chunks the code, and creates vector embeddings in Qdrant
3. **Analyze** — The codebase is analyzed using AI with relevant code chunks, pinned docs, and org knowledge
4. **Review** — The diff is reviewed by the LLM, generating findings with severity levels and category-based thresholds
5. **Comment** — Findings are posted as inline comments on the PR/MR, with one-click Linear or Jira issue creation

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

Please see [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

This project is licensed under the [Modified MIT License](LICENSE.md).
