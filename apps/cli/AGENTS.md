# AGENTS.md — apps/cli

Scoped rules for this package. The root [AGENTS.md](../../AGENTS.md) still applies.

This package is **the Octopus CLI** (`octp` binary). It replaces the previous npm-published `@octp/cli` — distributed natively via curl/irm, includes onboarding as a built-in TUI wizard.

## Stack constraints

- Built with **ink ^6** (React for terminals). Do **not** introduce a second TUI library.
- No Next.js, no Prisma, no database access. This package runs on the user's laptop with zero infrastructure.
- All persistence is to files under `$OCTOPUS_HOME` (default `~/.octopus/`). HTTP calls allowed for explicit needs only (auth, provider validation, repo listing).
- Secrets stay in `byok.json` / `credentials` — never in `config.json` (the prefs file must remain safe to `cat`).

## Subcommand conventions

- Subcommands dispatch from `src/index.tsx`'s `main()`. The set of recognised commands is the `KNOWN_SUBCOMMANDS` set — keep it in sync with `printHelp()`.
- Unknown subcommands and unknown flags fail fast with exit code 2 and a help hint. **Do not silently accept** unknown input; that's how typos waste users' time.
- New subcommands belong in `src/commands/<name>.ts`, exporting an async function that returns an exit code. `main()` should be a one-line dispatch per command, not a place for business logic.

## Step component conventions (onboarding)

- Each step is a self-contained component in `src/steps/`.
- Props: `{ onNext: (patch?) => void; onBack?: () => void }`. The wizard owns the answer accumulator; the step calls `onNext` with the fields it collected.
- Steps that do work (auth, validation, save) hold an internal `phase` state of `running | done | failed | skipped`. On `failed`, surface the error inline and offer `Enter to retry / Esc to skip`.
- Footer hint convention: `Press Enter to continue · Esc to skip · Left to go back`. Keep it on the last line of every step.

## Don't

- Don't render to `process.stdout` directly. Pipe subprocess output into React state, then render it.
- Don't `process.exit()` from a step. Call `useApp().exit()` so ink can clean up the terminal.
- Don't add `chalk` / `kleur` / other color libraries — use ink's `<Text color>` prop.
- Don't add a Node-only dependency that breaks Bun's `--compile` (no native modules without testing the cross-compile path).

## Testing

- `bun test` with `bun:test`. Use a per-test `OCTOPUS_HOME = mkdtemp()` and clean up in `afterEach`.
- Step components don't need full ink render tests yet (testing ink is awkward); cover the `lib/` utilities thoroughly instead and integration-test the wizard end-to-end in a follow-up.

## Release flow

1. Bump `package.json` version
2. `git tag octp-v0.X.Y && git push <remote> octp-v0.X.Y`
3. `.github/workflows/octp-release.yml` cross-compiles all five targets and publishes the GitHub Release with `SHA256SUMS.txt`
4. `install.sh` / `install.ps1` automatically pick it up — no manual update needed
