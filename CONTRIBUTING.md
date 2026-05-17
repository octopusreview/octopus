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

## Pull Request Guidelines

- Keep PRs focused on a single change
- Write a clear description of what your PR does and why
- Reference any related issues (`Closes #123` for bug fixes; `Part of #123` for sub-tasks of an epic)
- Make sure linting and type checks pass

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/). Examples from recent history: `fix(docs): ...`, `chore(deps): ...`, `docs(readme): ...`, `feat(reviewer): ...`. The scope is optional but appreciated.

## Picking up roadmap work

The [Roadmap](ROADMAP.md) is the source of truth for what's prioritised. Browse [open `roadmap`-labeled issues](https://github.com/octopusreview/octopus/issues?q=is%3Aopen+label%3Aroadmap) or filter by workstream (e.g. [`workstream:5-providers`](https://github.com/octopusreview/octopus/issues?q=is%3Aopen+label%3Aworkstream%3A5-providers)). Issues labeled [`good first issue`](https://github.com/octopusreview/octopus/issues?q=is%3Aopen+label%3A%22good+first+issue%22) are the best entry points.

To claim work:

1. Comment on the issue saying you're picking it up — gives maintainers a chance to flag context or duplicate efforts
2. Open a PR within ~2 weeks. If you need longer, leave a status comment so the issue doesn't get reassigned
3. Reference the issue in your PR (`Closes #N` or `Part of #N`)

For substantial proposals not yet on the roadmap, use the [Roadmap Proposal template](.github/ISSUE_TEMPLATE/roadmap_proposal.yml). See [GOVERNANCE.md](GOVERNANCE.md) for how proposals progress.

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
