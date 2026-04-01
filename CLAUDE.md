# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Octopus?

AI-powered PR review tool. Analyzes code via GitHub/Bitbucket webhooks, creates embeddings in Qdrant, reviews PRs with Claude/OpenAI, and posts findings as PR comments with severity levels.

## Monorepo Structure

- **apps/web** — Next.js 16 app (App Router, React 19, Tailwind CSS 4)
- **packages/db** — Prisma schema + shared DB client (PostgreSQL via `@prisma/adapter-pg`)
- **packages/agent-helpers** — SDK for external agents to query Octopus API
- **tools/tsconfig** — Shared TypeScript configs (`@octopus/tsconfig`)
- **tools/eslint-config** — Shared ESLint config

## Related Projects and Path

- CLI (../octopus-cli)
- VSCode Extension (../octopus-vscode)
- Claude Code Plugin (../octopus-claude-plugin)
## Commands

```bash
bun install              # Install dependencies
bun run dev              # Start all apps (turbo)
bun run build            # Build all packages
bun run lint             # Lint all packages
bun run typecheck        # Type-check all packages

# Database (run from root)
bun run db:generate      # Generate Prisma client
bun run db:migrate       # Run migrations (dev)
bun run db:push          # Push schema to DB (no migration)
bun run db:studio        # Open Prisma Studio
```
## Critical 

Do not use "npx tsc --noEmit", use "bunx tsc --noEmit --pretty 2>&1 | head -40" instead

## Architecture

### Environment & Config

- Root `.env` is loaded by both Next.js (`next.config.ts` uses dotenv with `../../.env`) and Prisma (`packages/db`)
- `next.config.ts` sets `output: "standalone"` and transpiles `@octopus/db`

### Auth (Better Auth)

- Config: `apps/web/lib/auth.ts` — Prisma adapter, Google/GitHub OAuth, magic link
- `auth.api.getSession()` returns only standard fields (id, name, email, image). Custom fields (onboardingCompleted, bannedAt, etc.) require a separate Prisma query
- Middleware (`apps/web/middleware.ts`) checks session cookie and redirects to `/login`
- Public routes: `/login`, `/blocked`, `/api/auth`, `/api/github`, `/api/bitbucket/webhook`, `/api/pubby`, `/api/version`, `/api/invitations`, `/api/slack/commands`, `/api/stripe`

### Route Groups

- `(app)/` — Protected routes: dashboard, chat, issues, knowledge, repositories, timeline, usage, settings, admin
- Root — Public: landing page, login, API routes

### Core Review Pipeline

1. **Webhook** → GitHub/Bitbucket sends PR event to API route
2. **Indexer** (`lib/indexer.ts`) — Clones repo, chunks code (1500 chars, 200 overlap), creates embeddings in Qdrant
3. **Analyzer** (`lib/analyzer.ts`) — Analyzes repo with Claude using code chunks + org knowledge
4. **Reviewer** (`lib/reviewer.ts`) — Fetches diff, runs review with LLM, posts findings as PR comments with severity (🔴/🟠/🟡/🔵/💡)
5. **Summarizer** (`lib/summarizer.ts`) — Generates repo purpose summaries

### Vector Search & Embeddings

- **Qdrant** for vector storage with collections: code_chunks, knowledge_chunks, review_chunks, chat_chunks, diagram_chunks
- **OpenAI text-embedding-3-large** (3072 dims) by default, orgs can configure custom models
- **Cohere Rerank** (`lib/reranker.ts`) for retrieved document re-ranking
- Embedding logic: `lib/embeddings.ts` (24k char max per chunk)

### AI Client & Cost Management

- `lib/ai-client.ts` — Model selection respects org config (Claude vs OpenAI)
- `lib/ai-usage.ts` — Tracks token usage per org/repo/operation
- `lib/cost.ts` — Monthly spend limit checks, credit balance logic
- Always check `isOrgOverSpendLimit()` before expensive LLM operations

### Real-time (Pubby)

- Server: `lib/pubby.ts` → `pubby.trigger(\`presence-org-${orgId}\`, event, data)`
- Client: `lib/pubby-client.ts` → singleton `getPubbyClient()`, subscribe & bind
- Auth: `/api/pubby/auth` — validates org membership for presence channels
- All org-scoped events flow through `presence-org-{orgId}` channels

### External Integrations

- **GitHub** (`lib/github.ts`) — App JWT, installation tokens, PR operations, webhooks
- **Bitbucket** (`lib/bitbucket.ts`) — OAuth, webhooks
- **Linear** (`lib/linear.ts`) — OAuth, issue creation
- **Slack** (`lib/slack-responder.ts`) — Responds to questions with codebase context
- **Stripe** — Billing, credits, webhooks

### UI

- **shadcn/ui** components in `apps/web/components/ui/` (Radix primitives + CVA + tailwind-merge)
- Icons: `@tabler/icons-react`
- Toasts: `sonner`
- Theme: `next-themes`

### Database

- Prisma client exported as singleton from `packages/db/src/index.ts`
- Web app re-exports via `apps/web/lib/db.ts`
- Key models: Organization (with API keys, spend limits, Stripe), Repository, User, ChatConversation, AiUsage, CreditTransaction

## Critical Rules

- **No hard deletes.** Use soft delete (`deletedAt: new Date()`) and filter with `where: { deletedAt: null }`. See `docs/RULE_NO_HARD_DELETES.md`. Exceptions: session tokens, cache entries, job queue items.
- **Server actions:** Use `<form action={...}>` not `onClick={() => serverAction()}` — redirect doesn't work properly with onClick.
- **Layout data:** Call `revalidatePath()` in server actions when layout data changes (layouts don't re-render on same-route navigation).
- **DB constraint errors:** Handle unique/FK constraint errors gracefully — never let raw DB errors reach the UI.

## New Feature Checklist

When building a new feature, always consider these cross-cutting concerns:

- **Audit log:** Log significant actions via `writeAuditLog()` (`lib/audit.ts`). Use appropriate category (`auth`, `email`, `review`, `repo`, `knowledge`, `billing`, `admin`, `system`) and include relevant metadata.
- **Event bus:** Emit events via `eventBus.emit()` (`lib/events/bus.ts`) so observers (email, audit, Pubby) can react. Define new event types in `lib/events/types.ts`.
- **Admin visibility:** If the feature has background jobs, queues, or async operations, add monitoring in the admin panel (`/admin/`).
- **Pubby real-time:** If the feature produces state changes users should see live, trigger via `pubby.trigger()` on the org's presence channel.
- **Email notifications:** If the feature produces events users care about, add to email observer (`lib/events/observers/email.observer.ts`) and respect user notification preferences.
- **Spend limits:** Always check `isOrgOverSpendLimit()` before expensive LLM operations (`lib/cost.ts`).

## Docs

All files under `docs/` must be written in English. Key docs:
- `docs/PRD.md` — Product requirements
- `docs/PUBBY_REALTIME.md` — Real-time architecture guide
- `docs/RULE_NO_HARD_DELETES.md` — Soft delete policy
