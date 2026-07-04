# Contributing to Octopus

Thank you for your interest in contributing to Octopus! We welcome contributions from the community.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/octopus.git`
3. Install dependencies: `bun install`
4. Copy `.env.example` to `.env` and configure your environment
5. Generate the Prisma client: `bun run db:generate`
6. Run migrations: `bun run db:migrate`
7. Start the dev server: `bun run dev`

## Development Workflow

1. Create a new branch from `master`: `git checkout -b feature/your-feature`
2. Make your changes
3. Run linting: `bun run lint`
4. Run type checks: `bun run typecheck`
5. Commit your changes with a clear message
6. Push to your fork and open a pull request

## Picking up roadmap work

The [ROADMAP.md](ROADMAP.md) **Up Next** section and the [Octopus Roadmap Project board](https://github.com/orgs/octopusreview/projects) list work that's committed but unclaimed.

1. Find an **Up Next** item you'd like to take
2. Comment on its tracking issue to claim it, so nobody duplicates effort
3. Open your PR and link it to the issue (e.g. `Closes #123`) so the board tracks progress
4. Maintainers aim to give an initial review within a few business days

If you want to propose new work rather than pick up existing work, open a [roadmap proposal issue](.github/ISSUE_TEMPLATE/roadmap_proposal.yml).

## Commit conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

Common types used in this repo:

- `feat` — a new feature
- `fix` — a bug fix
- `docs` — documentation only
- `ci` — CI/workflow changes
- `chore` — tooling, deps, or other housekeeping

Include a scope where it clarifies the area of change. Real examples from the history:

```
feat(login): replace 3D octopus with product-highlights panel
fix(docs): address review — migrate-before-start, complete octp rename
ci(release): push to GHCR with a scoped PAT, not GITHUB_TOKEN
fix(docker): keep CHANGELOG.md in the build context
```

## Releases

Maintainers cut a release by running `scripts/bump-version.sh X.Y.Z`, committing the version bump, then tagging `vX.Y.Z`. The script updates the `version` field in both `package.json` and `apps/web/package.json`.

## Pull Request Guidelines

- Keep PRs focused on a single change
- Write a clear description of what your PR does and why
- Reference any related issues
- Make sure linting and type checks pass

## Testing Your Changes

Before submitting a PR, make sure everything passes:

```bash
bun run lint          # ESLint
bun run typecheck     # TypeScript type checking
bun run build         # Full build
```

The CI pipeline runs these checks automatically on every pull request.

## Code Style

- We use TypeScript throughout the project
- Follow existing patterns in the codebase
- Use `@tabler/icons-react` for icons
- UI components are built with shadcn/ui (Radix + Tailwind)

## Questions?

Open a [GitHub Discussion](https://github.com/octopusreview/octopus/discussions) if you have questions or need help.
