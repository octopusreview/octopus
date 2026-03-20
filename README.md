<p align="center">
  <img src="apps/web/public/branding-banner.png" alt="Octopus — Your AI code reviewer that never sleeps" width="600" />
</p>

<p align="center">
  <a href="https://github.com/octopusreview/octopus/actions/workflows/ci.yml"><img src="https://github.com/octopusreview/octopus/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/octopusreview/octopus/actions/workflows/dependabot/dependabot-updates"><img src="https://github.com/octopusreview/octopus/actions/workflows/dependabot/dependabot-updates/badge.svg" alt="Dependabot Updates" /></a>
  <a href="https://github.com/octopusreview/octopus/actions/workflows/github-code-scanning/codeql"><img src="https://github.com/octopusreview/octopus/actions/workflows/github-code-scanning/codeql/badge.svg" alt="CodeQL" /></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/octopusreview/octopus/discussions"><img src="https://img.shields.io/github/discussions/octopusreview/octopus" alt="GitHub Discussions" /></a>
</p>

# Octopus

AI-powered PR review tool. Multi-armed code analysis — no bug escapes.

Octopus analyzes pull requests via GitHub and Bitbucket webhooks, creates code embeddings with vector search, reviews changes using Claude or OpenAI, and posts findings as inline PR comments with severity levels.

## Features

- **Automated PR Reviews** — AI-powered code review with severity indicators (🔴 Critical, 🟠 Major, 🟡 Minor, 🔵 Info, 💡 Suggestion)
- **Codebase Indexing** — Chunks and embeds your code into Qdrant for context-aware reviews
- **Multi-Provider AI** — Supports both Claude (Anthropic) and OpenAI models per organization
- **GitHub & Bitbucket** — Native webhook integrations for both platforms
- **Knowledge Base** — Organization-level knowledge that informs reviews
- **Slack Integration** — Ask questions about your codebase directly from Slack
- **Linear Integration** — Create issues from review findings
- **Real-time Updates** — Live dashboard updates via WebSocket (Pubby)
- **Usage & Cost Tracking** — Per-org token usage tracking with spend limits
- **Team Management** — Multi-org support with role-based access

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Next.js 16](https://nextjs.org) (App Router, React 19)
- **Styling:** [Tailwind CSS 4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)
- **Database:** PostgreSQL with [Prisma](https://prisma.io)
- **Vector Store:** [Qdrant](https://qdrant.tech)
- **Auth:** [Better Auth](https://www.better-auth.com) (Google, GitHub OAuth, Magic Link)
- **Monorepo:** [Turborepo](https://turbo.build)
- **Billing:** [Stripe](https://stripe.com)

## Project Structure

```
octopus/
├── apps/
│   └── web/              # Next.js web application
├── packages/
│   ├── db/               # Prisma schema & shared DB client
│   └── agent-helpers/    # SDK for external agents
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

1. **Webhook** — GitHub or Bitbucket sends a PR event to Octopus
2. **Index** — Octopus clones the repo, chunks the code, and creates vector embeddings in Qdrant
3. **Analyze** — The codebase is analyzed using AI with relevant code chunks and org knowledge
4. **Review** — The PR diff is reviewed by the LLM, generating findings with severity levels
5. **Comment** — Findings are posted as inline comments on the PR

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

Please see [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

This project is licensed under the [MIT License](LICENSE.md).
