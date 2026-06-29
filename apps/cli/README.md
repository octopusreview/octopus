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
