# @octopus/cli-onboard

First-run interactive setup wizard for the Octopus CLI. Built with [ink](https://github.com/vadimdemedes/ink) (React for terminals) and shipped as a **native binary** — no Node, no npm install, no system dependencies.

## Install

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/octopusreview/octopus/master/apps/cli-onboard/install/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/octopusreview/octopus/master/apps/cli-onboard/install/install.ps1 | iex
```

Both installers:

1. Detect your OS + CPU architecture
2. Fetch the latest `cli-onboard-v*` release from GitHub
3. Download the matching binary
4. Install it to `~/.octopus/bin/` (override with `OCTOPUS_INSTALL_DIR`)
5. Print a one-liner to add the install directory to your `PATH` (or update it directly on Windows)

Environment variables both installers respect:

| Variable | Purpose |
|---|---|
| `OCTOPUS_INSTALL_DIR` | Override install directory |
| `OCTOPUS_INSTALL_REPO` | Override the GitHub repo (e.g. for forks) |
| `OCTOPUS_INSTALL_TAG` | Pin a specific tag instead of fetching latest |

## Run

```
octp-onboard
```

The first run launches the wizard. Subsequent runs detect the saved state and exit immediately unless you pass `--reset`.

## What it does

Walks a new user from "I just installed `octp`" to "my next `git push` triggers an AI review using the model I picked":

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

A corrupt or unreadable `config.json` is treated as missing — the wizard re-runs instead of crashing.

## Opt-outs

- `OCTOPUS_NO_ONBOARD=1` — permanent skip (env var)
- `--skip-onboard` — one-shot skip (CLI flag)
- `--reset` — re-runs the wizard, pre-seeding existing config

## Build from source

```bash
cd apps/cli-onboard
bun install
bun run dev                     # run from source in your terminal
bun run build:compile           # cross-compile all 5 native targets to dist/
bun run build:compile:darwin-arm64  # single target
bun test                        # run unit tests
```

Cross-compile targets:

| Asset | Platform |
|---|---|
| `octp-onboard-linux-x64` | Linux Intel/AMD |
| `octp-onboard-linux-arm64` | Linux ARM (Raspberry Pi, AWS Graviton) |
| `octp-onboard-darwin-x64` | macOS Intel |
| `octp-onboard-darwin-arm64` | macOS Apple Silicon |
| `octp-onboard-windows-x64.exe` | Windows Intel/AMD |

## Releases

Tagging `cli-onboard-v<semver>` on the upstream repo triggers `.github/workflows/cli-onboard-release.yml`, which cross-compiles all five binaries, generates SHA256 checksums, and publishes a GitHub Release with auto-generated notes. The install scripts always fetch the latest tagged release.

## Status

Phase 1 (this commit): package skeleton + native installer infrastructure + Welcome → Done flow + config persistence + opt-outs. Real steps land in follow-up PRs tracked under [Workstream 7](../../README.md#roadmap) (epic [#61](https://github.com/cemoso/octopus/issues/61)).
