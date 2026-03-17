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

Open a [GitHub Discussion](https://github.com/octopus-review/octopus/discussions) if you have questions or need help.
