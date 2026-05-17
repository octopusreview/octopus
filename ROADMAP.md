# Roadmap

This is a living document. It captures what Octopus is working on, what is queued, and what the community is invited to discuss. It is **not a commitment** — priorities shift as the project learns.

For the live, sortable view, see the [Octopus Roadmap Project board](https://github.com/orgs/octopusreview/projects).
The [CHANGELOG](CHANGELOG.md) is the source of truth for what has actually shipped.

---

## Recently Shipped

Highlights from the last few releases. See [CHANGELOG.md](CHANGELOG.md) for the full list.

- GitLab integration: OAuth, webhook, and merge request review support
- Knowledge Center: pinned documents that are always included in every review
- Repo config files (`.octopus.md` / `AGENTS.md` / `CLAUDE.md`) with sandboxed rule extraction
- Jira integration: one-click issue creation from review findings
- Async community review pipeline for free open-source reviews
- Repository graph view with structural and semantic edges
- Real-time status page

## In Progress

Work that has an owner and is actively being built. Each item links to its tracking issue.

_Add items here as they enter active development._

## Up Next

Committed for the next quarter or so. Loose ordering; reshuffled as priorities shift.

- **Self-hosted update page** — n8n-style "you are on X, latest is Y" with copy-paste upgrade instructions (`workstream:1-self-host`)
- **Ollama / local model support** — direct connect for self-hosters + a laptop-agent bridge for cloud users (`workstream:2-ollama`)
- **Roadmap & governance docs** — this document, plus `GOVERNANCE.md`, `MAINTAINERS.md`, `SUPPORT.md` (`workstream:3-roadmap`)
- **Compliance posture** — surface existing audit-log infrastructure to enterprise buyers; ship sub-processors list, DPA template, SOC2 readiness self-assessment, audit-log UI (`workstream:4-compliance`)
- **More AI providers** — `codex` (default), `grok`, `acpx` (ACP-compatible: Claude/Pi/Gemini), `opencode`, plus `mock`/`mock-fail` for tests (`workstream:5-providers`)
- **Architectural refactors** — unified `Provider` interface, Zod-derived JSON schemas, robust JSON extraction, anti-hallucination prompt fields, content-derived finding signatures so user triage survives PR re-reviews (`workstream:6-clawpatch-ports`)

## Proposed

Ideas that are worth doing but not committed. Open a [GitHub Discussion](https://github.com/octopusreview/octopus/discussions) to argue for promotion to **Up Next**, or use the [roadmap proposal template](.github/ISSUE_TEMPLATE/roadmap_proposal.yml).

- IDE extensions (VS Code / JetBrains) for inline review hints pre-push
- Automated regression test generation from `suggestedRegressionTest` finding fields
- Per-finding fix-suggestion patches that can be applied with one click
- Custom severity rubrics per repo (override central category thresholds)
- Per-language reviewer prompts (specialized passes for Go / Python / Rust)
- Configurable retention windows per `AuditLog` category

## Out of Scope

Ideas the maintainers have considered and declined, with a one-line rationale to spare repeated proposals.

- **Self-hosted billing / license server** — keep self-hosted free; revenue stays with the hosted offering
- **Web IDE / in-app code editing** — out of scope; Octopus reviews code, it does not edit it
- **Native mobile app** — the web app is responsive; native effort is not justified

---

## How proposals progress

1. **Idea** → open a Discussion or a roadmap-proposal issue
2. **Proposed** → maintainers add the `roadmap` label and (if relevant) a `workstream:*` label
3. **Up Next** → an owner is assigned and the item moves to the Project board
4. **In Progress** → linked PR exists
5. **Shipped** → released and listed in [CHANGELOG.md](CHANGELOG.md)

See [GOVERNANCE.md](GOVERNANCE.md) for how decisions get made and who makes them.
