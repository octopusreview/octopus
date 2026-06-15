# AGENTS.md

Repo-scoped rules for AI agents reviewing or editing this codebase. Octopus reads this file as part of its review pipeline (per the [Repo Config Files](README.md#features) feature) and human contributors are welcome to follow the same conventions.

For human-oriented setup, workflow, and PR guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md). For project direction see [ROADMAP.md](ROADMAP.md).

## Before submitting a change

Run all four locally. CI will reject if any fail.

```bash
bun install              # if dependencies haven't been installed
bun run lint
bun run typecheck
bun run test
bun run build
```

## Repository layout

```
apps/web/                     Next.js 16 web app + API routes (the bulk of the code)
packages/db/                  Prisma schema, migrations, and shared client
packages/package-analyzer/    Package metadata + safety analyzer
tools/{tsconfig,eslint-config}/  Shared dev config
```

The `@octp/cli` package referenced in the README lives in a separate repository; changes targeting the CLI do not belong in this repo.

## Conventions that matter for AI-suggested changes

### Database access
- Always import the Prisma client as `import { prisma } from "@octopus/db"`. Never instantiate `new PrismaClient()` directly.
- Files that touch `prisma` must start with `import "server-only";` so they never leak into client bundles.
- Prisma schema changes require a SQL migration in `packages/db/prisma/migrations/<timestamp>_<slug>/migration.sql` in the same PR. The migrations directory is git-ignored by default; force-add new ones (`git add -f`) — that matches existing convention.

### AI provider calls
- All chat/completion calls go through `apps/web/lib/ai-router.ts`'s `createAiMessage`. Do not import provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/generative-ai`) directly elsewhere.
- The router resolves the provider from the model ID (DB cache, prefix fallback) and selects per-org BYOK keys. Adding a new provider means extending the router; do not work around it.
- Embeddings currently route through `apps/web/lib/embeddings.ts` (OpenAI-only at the moment). Pricing data lives in `apps/web/lib/cost.ts`; the `AvailableModel` Prisma table is the source of truth for provider mapping.

### Review pipeline
- The review prompt lives at `apps/web/prompts/SYSTEM_PROMPT.md`. Treat it as code — small wording changes can shift finding rates noticeably.
- Findings are emitted as a JSON array between `<!-- OCTOPUS_FINDINGS_START -->` and `<!-- OCTOPUS_FINDINGS_END -->` markers. Parsing lives in `apps/web/lib/review-dedup.ts:parseFindingsFromJson`. Preserve the marker format; downstream consumers depend on it.
- Inline-comment rendering is in `apps/web/lib/review-helpers.ts:buildInlineComments`. The section order (severity/title → description → suggestion → fix prompt) is deliberate; don't reshuffle without coordination.

### Tests
- Use `bun:test` (`import { describe, it, expect } from "bun:test"`). Do not pull in jest/vitest.
- Tests live in `apps/web/lib/__tests__/`. Mirror the name of the file under test (`foo.ts` → `foo.test.ts`).
- For files that import `prisma` at the top level (e.g. `cost.ts`), mock `@octopus/db` at the top of the test using `mock.module("@octopus/db", () => ({ prisma: {} }))` — see `cost.test.ts` for the pattern.

### UI
- Shadcn/ui components are the default. Add new components via `bunx shadcn@latest add <name>`, then commit the generated file.
- Icons come from `@tabler/icons-react`. Don't introduce a second icon library.
- Tailwind 4 + the existing tokens — don't add custom CSS files for things that compose from Tailwind.

### Dependencies
- Adding a new npm dependency needs a clear justification in the PR description. Prefer transitive deps that already exist over new top-level adds.
- Major-version bumps go through a dedicated PR.

## Commits and PRs

- [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): …`, `fix(scope): …`, `chore(deps): …`, `docs(scope): …`, `refactor(scope): …`.
- One change per PR. Reviewer-bot quality gate is **4+/5**; 🔴 critical findings must be addressed before merge.
- Reference issues via `Closes #N` (closes on merge) or `Part of #N` (epic sub-task).

## What not to do

- Do not commit secrets. `.env`, `.env.local`, and similar are git-ignored; double-check before pushing.
- Do not bypass Git hooks (`--no-verify`, `--no-gpg-sign`) without explicit authorisation. If a hook fails, fix the underlying issue.
- Do not force-push to shared branches. Local feature branches before review are fine; published PR branches are not.
- Do not amend or squash commits that have been reviewed. Add new commits on top.
- Do not delete or rename `packages/db/prisma/migrations/<timestamp>_*/migration.sql` files after they ship — they're immutable history once any environment has run them.
