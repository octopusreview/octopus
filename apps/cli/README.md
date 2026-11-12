# @octopus/cli

The Octopus CLI. Built with [ink](https://github.com/vadimdemedes/ink) (React for terminals), distributed as a **native single binary** (Bun-compiled). No Node, no npm install, no runtime dependencies.

Replaces the previous npm-published `@octp/cli` package — different distribution model, more features.

## Install

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/octopusreview/octopus/master/apps/cli/install/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/octopusreview/octopus/master/apps/cli/install/install.ps1 | iex
```

Both installers:

1. Detect your OS + CPU architecture
2. Fetch the latest `octp-v*` release from GitHub
3. Download the matching binary
4. Install it to `~/.octopus/bin/octp` (override with `OCTOPUS_INSTALL_DIR`)
5. Print a one-liner to add the install directory to your `PATH` (or update it directly on Windows)

Environment variables both installers respect:

| Variable | Purpose |
|---|---|
| `OCTOPUS_INSTALL_DIR` | Override install directory |
| `OCTOPUS_INSTALL_REPO` | Override the GitHub repo (e.g. for forks) |
| `OCTOPUS_INSTALL_TAG` | Pin a specific tag instead of fetching latest |

## Commands

```
octp                       Launch the onboarding wizard (first run) or dashboard
octp onboard [--reset]     Run the onboarding wizard explicitly
octp review [--staged]     Review local changes before opening a PR
                           --staged: only diff what's in the staging index
                           --since <ref>: diff from <ref> instead of HEAD
                           --index: index the working tree for context-aware review
                           --no-index: skip the index prompt, review in bare mode
octp agent serve           Start the local-agent bridge for Ollama / Claude CLI
octp doctor                Environment + auth health check
octp config <get|set>      Manage ~/.octopus/config.json               (coming soon)
octp --version | -v        Print version
octp --help | -h           Print this help
```

Local review failures return a generic message when provider details are unsafe
to expose. Configuration errors can provide actionable advice; development
servers also return vetted embedding configuration advice.

For Ollama tasks, `octp agent serve` allows five minutes for the full response,
including success and error bodies. Set `OCTP_OLLAMA_TIMEOUT_MS` to a positive
number of milliseconds to change this limit.

For `octp review`, an organization-owned provider credential rejection advises
checking the key and its permissions or choosing another model in
`/settings/models`. An Ollama connection failure advises checking that the local
model is running and reachable. Other provider failures can return a generic
error without identifying the cause or exposing provider response details.

The first invocation of bare `octp` triggers the onboarding wizard:

1. **Welcome** — what Octopus is, in three sentences
2. **Auth** — sign in to the hosted Octopus account *or* point at a self-hosted instance
3. **Org** — pick the organisation context (hosted only)
4. **Provider** — pick which AI provider runs the review (Claude / OpenAI / Google / Cohere; with Workstream 5 also Grok / ACPX / OpenCode / Ollama)
5. **Model** — pick a model from the chosen provider
6. **BYOK** — enter the API key (or skip and use the org's platform key)
7. **Validate** — live API ping to confirm the key works
8. **Repo install** — pick a GitHub repo and install the Octopus App (hosted only)
9. **Done** — summary of what was configured + next steps

Each step is small, has phase-state (`running | done | failed | skipped`), and follows the same footer convention: `Enter to continue · Esc to skip · Left to go back`.

## Set up a repository with your AI

Give the [homepage setup prompt](https://octopus-review.ai/#agent-setup) to the
coding agent already working on your project.

This requires a CLI and server version that include agent onboarding. Older
servers return an explicit unsupported-server error; use the
[CLI setup guide](https://octopus-review.ai/docs/cli) for those installations.

```bash
octp onboard --agent --json
# Explicit GitHub target, with a named Octopus account:
octp --account work onboard --agent --json --repo owner/repository
```

The command runs without a TTY and returns one newline-terminated JSON result per
invocation. It finishes writing the result to stdout before exiting, including
when a coding agent captures output through a pipe.
`schemaVersion` is `1`. `state`, `completed`, `nextAction` and `continueWith`
tell the agent what to do next. Commands are argument arrays, so the agent
should execute them as arguments without interpolating them into a shell.
Respect `retryAfterSeconds` between status checks.
Exit codes: **0** ready, **3** waiting or approval required, **2** invalid input,
**1** failed. Exit 3 is an expected handoff, not a command failure.

The first run detects the GitHub repository from the current remote. Authentication
uses `octp login --no-open`, which prints the approval URL and waits for the
user. The agent keeps that login process running until it finishes, then resumes
onboarding. CLI 0.6.0 and server 1.0.157 add user-level login: browser approval does not
select an organisation. The session expires after 30 days; `octp logout` revokes
it and its derived organisation credentials. Login credentials stay in the
existing account store.

```bash
octp login --no-open
octp org list --json
octp --org acme onboard --agent --json --repo acme/app
octp --org another-org repo list
```

`--org` accepts an organisation slug or ID for that command only. Without it,
Octopus uses a unique repository match, then a unique GitHub owner match among
active, non-dismissed repositories in your current organisations. An explicit
repository target takes priority over the working directory. If that target
cannot be resolved uniquely (including a short repository name), choose with
`--org`; the CLI only consults the current Git remote when no target was supplied.
Agent onboarding can select a single organisation with no GitHub installation
to start its first installation.

When a choice is needed, agent onboarding returns `organization_required` and
the available `organizations` in JSON. Other organisation-scoped commands print
the choices to stderr. Both exit 3 before starting work. Ask which organisation
to use and retry with `--org`. A new user with no memberships must create or join
an organisation in Octopus first.

Local `agent watch` operations remain offline and use `--account` for their
profile; they do not accept `--org`. Use `--org` with `agent serve` when selecting
the organisation for an authenticated bridge.

`--account` switches saved user profiles; `--org` switches organisations within
one user's current memberships. Existing organisation tokens continue to work
for their original organisation. Run `octp login` again to replace one with a
user session and enable switching. The interactive wizard and `setup-token`
retain their organisation-scoped flow for compatibility and CI credentials.
User login saves only the user secret; organisation credentials stay local to
the command. Each organisation API authentication checks the parent session's
expiry and revocation, current membership, and account standing. These credentials
retain existing organisation-token permissions; the user secret itself cannot
authenticate an organisation API request.

For repository access, the command returns the signed GitHub App installation
link or the existing installation's repository settings link. Once access is
available, Octopus imports the target repository and the agent follows indexing
and analysis. Re-running setup reads live server status; completed work is reused.
Failed jobs remain failed for inspection instead of being retried automatically.
An active repository record takes precedence over inactive history with the same
GitHub name in the organisation. If only a dismissed record remains, setup requires
a restore decision.
If work fails or makes no progress for ten minutes, report the exact state and
continuation command. Opening an approval link does not prove setup completed.

The first version supports github.com repositories, including self-hosted Octopus
servers with a configured GitHub App. It keeps existing organisation model and
billing defaults. It does not configure GitLab/Bitbucket, persist an in-flight login
across a terminated login process, or make existing server analysis jobs durable
across server restarts. An organisation owner's pending GitHub approval is described
at the approval step; the command cannot independently distinguish it from an
installation that has not yet been completed.

## Persistence

State lives under `$OCTOPUS_HOME` (default `~/.octopus/`) in three files, all mode `0600` in a mode `0700` directory:

| File | Purpose | Safe to cat? |
|---|---|---|
| `config.json` | Versioned prefs (chosen provider/model, defaults). Presence of `onboardedAt` gates first-run. | Yes |
| `byok.json` | Provider API keys, separated from prefs. | No |
| `credentials` | Auth tokens for the hosted Octopus account. | No |

A corrupt or unreadable `config.json` is treated as missing — the onboarding wizard re-runs instead of crashing.

## Opt-outs

- `OCTOPUS_NO_ONBOARD=1` — permanent skip (env var)
- `--skip-onboard` — one-shot skip (CLI flag)
- `--reset` — re-runs the wizard, pre-seeding existing config

## Build from source

```bash
cd apps/cli
bun install
bun run dev                       # run from source in your terminal
bun run build:compile             # cross-compile all 5 native targets to dist/
bun run build:compile:darwin-arm64  # single target
bun test                          # run unit tests
```

Cross-compile targets:

| Asset | Platform |
|---|---|
| `octp-linux-x64` | Linux Intel/AMD |
| `octp-linux-arm64` | Linux ARM (Raspberry Pi, AWS Graviton) |
| `octp-darwin-x64` | macOS Intel |
| `octp-darwin-arm64` | macOS Apple Silicon |
| `octp-windows-x64.exe` | Windows Intel/AMD |

## Releases

Tagging `octp-v<semver>` on the upstream repo triggers `.github/workflows/octp-release.yml`, which cross-compiles all five binaries, generates SHA256 checksums, and publishes a GitHub Release with auto-generated notes. The install scripts always fetch the latest tagged release.

```bash
# bump apps/cli/package.json version first, commit, then:
git tag octp-v0.1.0
git push origin octp-v0.1.0
```

## Status

The onboarding wizard, `octp review`, `octp agent serve`, and `octp doctor`
all ship. Only `octp config <get|set>` is still on the roadmap — set
config values via the wizard (`octp onboard --reset`) until then.
