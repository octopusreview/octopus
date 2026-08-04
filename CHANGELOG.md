# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Local agent API endpoints now treat the organization API token as the security boundary: a registered agent name held by an active token can no longer be taken over or acted on by a different token in the same organization, and task claims, results, and LLM-task completions are bound to the token that registered the agent. Deleting a token frees its agent names for reuse. Agents that intentionally share one token keep sharing authority — use separate tokens for separate boundaries.
- Agent task results larger than the 1 MiB transport limit are now rejected with HTTP 413 and the task is marked failed instead of staying stuck in a claimed state. Stored results remain capped at 50 KiB, now truncated to a bounded prefix that preserves the result's JSON type, and text is sanitized so PostgreSQL-incompatible characters can no longer poison result storage. Agent endpoints reject inputs containing PostgreSQL-invalid characters (NUL, lone surrogates) with HTTP 400 before any database access — registration and heartbeat names, repository lists, and machine info, plus `agentId` lookup keys and task id path parameters across all agent routes. Posting a result to a search task, or a completion to an LLM task, that is not in claimed state now returns HTTP 409 instead of an ownership error. Malformed JSON bodies on agent endpoints are rejected with an explicit HTTP 400 `Invalid request body` (413 stays reserved for oversized bodies), and agent registration stores omitted or explicit-null machine info as SQL `NULL` rather than a JSON null value.

## [1.0.93] - 2026-08-02

### Security
- GitHub webhook deliveries are now recorded in a signature-verified delivery ledger that cross-checks tenant routing in shadow mode — observation only, with no change to how reviews are dispatched. Only bounded metadata is stored (never payload content), retained 30 days by default; self-hosted deployments can tune this via `WEBHOOK_DELIVERY_RETENTION_DAYS`.

## [1.0.91] - 2026-08-01

### Security
- OAuth connect flows for Linear, Jira, and Bitbucket now bind the sign-in state to the browser and user that started it, closing a CSRF gap when connecting those integrations.

## [1.0.90] - 2026-08-01

### Security
- Security-hardening pass across integration and local trust boundaries: fixed an open redirect on the post-auth return path (including a control-character bypass), tightened cookie cleanup, and locked down CI token permissions.

## [1.0.89] - 2026-07-30

_Reviews now spend their budget on your code, not on generated files._

### Changed
- Generated files — dependency lockfiles, ORM migration snapshots, test snapshots, minified/bundled output, and anything your repo marks `linguist-generated` in `.gitattributes` — are excluded from review, so a large generated file can no longer crowd your hand-written changes out of the review. Excluded files are listed in the review summary.

## [1.0.88] - 2026-07-30

_Large pull requests now get reviewed in full._

### Changed
- Increased how much of a diff a review covers (~10×) and stopped silently truncating large diffs, so files further down a big PR are no longer skipped. When a diff is genuinely too large it now says so, instead of scoring a partial view. Tunable per deployment.

## [1.0.87] - 2026-07-30

_Self-hosting: create your GitHub App in one click._

### Added
- Self-hosted instances can create the required GitHub App automatically from Settings → Integrations. One button runs GitHub's App Manifest flow, stores the credentials, and takes you straight to installing it on your repositories — no more copying App ID, private key, and webhook secret into `.env` by hand. Create it under your account or a GitHub organization.

## [1.0.85] - 2026-07-29

_Review public open-source PRs without granting write access._

### Added
- New OSS bot-account review mode: a zero-permission GitHub Action notifies Octopus, which reviews the pull request server-side and posts as a shared bot account. Because that bot is a non-collaborator, GitHub's own permissions make it comment-only — the guarantee security-conscious maintainers ask for, with no write token running in CI. Opt in per repository with a consent file.

## [1.0.80] - 2026-07-29

### Added
- Auto-review now skips draft pull requests and runs automatically when a PR is marked ready for review, so work-in-progress is no longer reviewed prematurely. A manual `@octopus` mention still reviews a draft on request.

### Changed
- The community daily-limit message now links to pricing, so hitting the limit points to a clear next step instead of a dead end.

## [1.0.79] - 2026-07-29

_Claude Opus 4.8 is the default reviewer, with a new reasoning-effort control._

### Added
- Reasoning effort for extended-thinking models (Fable, Opus 5) is now configurable platform-wide and per organization, so you can trade review depth against speed and cost.

### Changed
- The default review model is now Claude Opus 4.8.

## [1.0.62] - 2026-07-25

_Claude Opus 5 and Fable 5 are now selectable review models, and the Opus tier is now cheaper._

### Added
- Claude Opus 5 is available as an opt-in premium review model. Your default reviewer is unchanged; point a repository at Opus 5 in settings when you want a deeper read on a tricky change (gnarly concurrency, a security-sensitive change, a big refactor). Works with your own Anthropic key too.
- Claude Fable 5, Anthropic's frontier model, is available as the top opt-in tier for the most demanding reviews.

### Changed
- The Opus review tier now costs $5 / $25 per million tokens, down from $15 / $75, matching Anthropic's current Opus pricing. Opus 4.6 is replaced by Opus 4.8 in the model list.

## [1.0.58] - 2026-07-24

_A major upgrade to review quality — sharper, language-aware reviews with fewer false positives. On by default; no action needed._

### Added
- Reviews now learn from your team's past reviews of similar code, staying consistent with earlier decisions and no longer re-raising issues you have already settled
- Reviews now read each pull request's title and description and check the change against it — flagging changes that do not do what they claim, miss a stated requirement, or expand scope unexpectedly
- Built-in, language-aware rulepacks for TypeScript/JavaScript, Python, Go, Rust, Java, and Ruby, plus an always-on security pack covering the OWASP Top 10 and common CWE weaknesses, so reviews catch idiomatic and security issues rather than only generic ones
- Security findings now include the relevant CWE identifier where one applies

### Changed
- More accurate findings with fewer false positives: an adversarial validation step now challenges each finding and keeps only those backed by concrete evidence, and every finding — inline and in the summary — is held to the same standard
- Smarter context retrieval surfaces the most relevant code from across the entire pull request, not just the first part of large diffs
- Large pull requests now run through the full review-quality pipeline instead of a lighter path
- Routine changes (lockfiles, generated files, docs, tiny edits) use a lighter, faster model, and review prompts are cached for quicker repeat reviews on active repositories

## [1.0.26] - 2026-07-03

### Changed
- Login page now shows a product-highlights panel in place of the 3D scene, cutting time-to-first-paint on the login screen
- Documentation accuracy overhaul: self-hosting build/upgrade/migration steps, CLI command names, and the pricing table now match the shipped platform

### Fixed
- OAuth provider gate is evaluated per-request, so correctly configured providers no longer show "(not configured)"

## [1.0.25] - 2026-07-02

### Fixed
- OAuth provider gate was rendered at build time, which disabled all providers in production

## [1.0.24] - 2026-07-02

### Added
- Release pipeline builds a hosted-deploy image variant alongside the self-host image
- OCI `revision`/`version` image labels

## [1.0.23] - 2026-06-30

### Fixed
- Stripe billing hardening: pinned API version, self-healing customer records, and a webhook retry contract with idempotent per-refund accounting
- Release build fixes: build context, lockfile workspace, and registry auth

_Versions 1.0.20–1.0.22 were tagged but not published (release-pipeline repairs); their fixes ship in 1.0.23._

## [1.0.19] - 2026-06-16

### Added
- Robust JSON extraction with three-tier recovery for more reliable review parsing (#526)
- Anti-hallucination fields on every finding to reduce false positives (#525)
- Public roadmap, governance, contributor, and SOC 2 readiness docs (#524)

### Fixed
- Finding descriptions in the review summary table are no longer truncated (#515)
- Embedding vector dimension is now validated against the Qdrant collection (#521)
- Raised max_tokens floor and enabled streaming for always-thinking models (#523)
- Detailed findings are now stripped correctly across more comment shapes (#512)
- Self-hosted web container now receives the user .env via env_file (#520)
- All Anthropic text blocks are collected; empty responses now fail loudly (#522)
- Health and readiness probes are allowed through the auth middleware (#518)
- Prompt variable substitution now handles special characters safely (#517)
- Review dedup no longer crashes on null items and preserves non-Latin keywords (#516)

### Security
- Moved createOrgForUser out of a "use server" module so it is not exposed as a server action (#519)

## [1.0.18] - 2026-06-11

### Added
- Admins now have the same organization permissions as owners (#510)
- Health and readiness probes at /api/health and /api/ready (#470)
- Question/support issue template for GitHub (#439)

### Fixed
- PR comment bodies are truncated to avoid GitHub 422 errors on long reviews (#511)
- Review score table denominators are now always normalized to /5 (#509)
- GitLab webhook route is no longer blocked by auth middleware (#404)

### Changed
- Homepage title and meta reworked for AI code review positioning

### Security
- Public Ask Octopus widget hardened against abuse and model disclosure (#405)

## [1.0.17] - 2026-06-03

### Added
- Rate-limit team invitations to prevent email spam abuse (#400)
- GitLab/CLI: show OAuth redirect URI and scopes, and review unsynced PRs on demand (#399)
- OpenAI Codex (gpt-5.3-codex) support via the Responses API (#397)
- Adaptive low-credit warning threshold based on burn rate (#396)
- Gate chat completion on the org spend limit (#385)
- Microsoft social login, with Graph-based email resolution and account linking (#383)
- Remove and restore repositories with sync-safe dismissal (#379)
- Seed GPT-5 Codex and GPT-5 Codex Mini models (#374)
- Docs: right-side table of contents, floating Ask AI, and restructured navigation

### Fixed
- Verify "missing X" findings against the full file to kill truncated-diff false positives (#392)
- Encrypt per-org AI provider keys at rest and decouple the data key (#395)
- Bitbucket: cache repo file tree by branch HEAD SHA to stop rate limits (#398)
- Bitbucket: resolve integration by webhook UUID to fix multi-tenant 401 errors (#382)
- Qdrant: skip upsert for points with empty embedding vectors (#384)
- Repo graph labels and focus state now readable in light mode (#386)
- Email: claim credit-low cooldown atomically to prevent duplicate sends (#381)
- GitHub: redirect to login when the install callback has no state (#380)

## [1.0.16] - 2026-05-11

### Added
- GitLab integration: OAuth, webhook, and merge request review support (#360)
- Encrypt all integration OAuth tokens at rest (#363)
- Chat now uses the org-selected model and surfaces defaults in settings (#364)
- Show the resolved AI model in repository AI Models dropdowns (#367)
- Async community review pipeline and configurable announcement bar (#358)
- Admin endpoint to retry stuck PR reviews (#356)
- Copy button on assistant chat messages
- Open-source landing page with nav, footer, and hero links
- Announce free reviews for open source projects (#345)
- GitHub Action documentation page (#357)
- Bug bounty policy, hall of fame, and security.txt

### Fixed
- GitLab clone failing with "could not read Username" because git smart-http rejects Bearer (#366)
- Ask Octopus chat: cap response length and abort stream on connection close (#355)
- Skip credit check for community orgs to prevent cost errors (#343)
- GitHub Action now rejects an invalid API token instead of silently falling back to community (#344)
- Qdrant: retry transient network errors on upsert
- Qdrant: return empty results when the query vector is empty (#342)
- Escape semicolons in Mermaid sequence diagram messages
- Reset repository analysis status when a run is cancelled

## [1.0.15] - 2026-05-01

### Added
- Knowledge Center: pin documents to always include in every review, regardless of diff similarity (#317)
- Review output language: organization-level setting for the prose language of summaries, finding titles, and descriptions. Code, identifiers, and `suggestion` fields stay in the source language. (#318)
- Repository-level config files (`.octopus.md` / `AGENTS.md` / `CLAUDE.md`, customizable). Opt-in per repo. Each enabled repo runs the file through a sandboxed Haiku extraction pass that strips meta-instructions and emits a clean rule list, cached by content hash. Extracted rules are injected as untrusted data inside the user message, never the system prompt. (#319)
- Central review category list with per-category severity thresholds and a pill-style picker (#330)
- Landing page refresh: provider chips, new hero, and a feature switcher (#334)
- Explainer banner for pinned documents in the Knowledge Center (#336)
- Route reviews of 300+ file PRs to a dedicated internal-cli worker (#309)

### Fixed
- Snap findings whose line range partially misses the diff onto the nearest changed line within ±10 lines, with a small note. Previously high-severity findings could drop to the summary table even when the change was within reach. (#321)
- Show "✅ No new issues detected since the last review" on re-reviews with zero findings, instead of leaving the comment looking empty. (#321)
- Sanitize mermaid blocks in review body before posting to GitHub (#310)
- Gate internal-cli routing behind `ENABLE_INTERNAL_CLI` flag
- Match `.octopus-ignore` artifact directories by path segment instead of substring (#328)
- Tighten Ask Octopus scope guards and stop message overflow (#332)
- Compute resolved-finding count from outdated prior comments rather than the live set (#338)

### Changed
- Tighten the LLM prompt to require finding line numbers reference added (`+`) lines in the diff, not context lines. (#321)

## [1.0.14] - 2026-04-29

### Added
- Jira integration: connect a workspace, map repositories to projects, and create issues from review findings (#265)
- Repository graph view with structural and semantic edges (#287)
- "The Story" section on landing page and X (Twitter) link in footer (#302)
- Boot-time reconciliation of stale repository states for improved reliability (#296)
- Cross-process review cancellation via Redis pub/sub (#294)

### Fixed
- Embeddings batching splits on 300k-token errors with a tighter estimate (#298)
- Deterministic UUID mapping in Qdrant for non-UUID point IDs (#300)
- Default branch now resolved from GitHub repo metadata instead of webhook payload (#290)
- Sidebar scroll overflow and safe-area inset on the bottom row (#308)

### Changed
- Usage page redesigned around user-facing activities (#306)
- Version-update toast redesigned with a changelog link

## [1.0.13] - 2026-04-24

### Added
- Comparison landing pages: /compare hub, /vs-coderabbit, /vs-greptile (#275)
- HMAC-signed GitHub App install flow with clearer error dialogs (#273)
- Rotating "Ask anything" entry point in the app sidebar (#279)
- Help & Docs menu in the app sidebar (#248)
- Organization avatar upload (Cloudflare R2) (#249)
- Email validation and Gmail alias normalization on sign-up (#264)
- Refreshed landing footer social links (#247)

### Fixed
- Embeddings batching now respects OpenAI's 300k-token per-request limit (#283)
- Prevent duplicate review runs across replicas (#266)
- Transaction history pagination shows the correct total (#263)
- Balanced Mermaid activate/deactivate across alt/else branches
- Rename Mermaid sequence participants that collide with reserved keywords (#250)
- Chat responds in the language of the user's latest message only (#254)

### Changed
- SEO pass across docs and blog: canonical URLs, richer meta descriptions, BlogPosting JSON-LD, explicit AI-bot rules in robots.txt (#277)

### Removed
- In-app admin panel (#260)

## [1.0.12] - 2026-04-16

### Added
- User display name management with auto-derive from email (#232)
- CLI quick start guide on API tokens page (#235)
- Redesigned landing page feature grid with hero card layout (#208)
- Coupon code system for credit redemption (#213)
- Organization creation limited to 3 per user (#214)

### Fixed
- Scope repository unique constraint to organizationId and rework Bitbucket workspace OAuth (#231)
- Pass orgId through GitHub OAuth state for reliable org association (#207)
- Org membership validation on Pubby auth and trigger endpoints (#220)
- Input validation on user and organization name fields (#219)
- Harden /api/auth/device against abuse (#203)
- Spend limit banner shows detailed status (#215)
- Event bus observer initialization race condition (#209)
- Issue creation dialog content overflow on long descriptions (#234)
- Blog slug uniqueness respects soft-deletes (#233)

### Security
- Remove deprecated collab integration and fix IDOR in generateIssueContent (#217)

## [1.0.11] - 2026-04-09

### Added
- Finding verification via Qdrant to reduce false positives
- Review Logs page (#195)
- Production-ready Terraform for AWS self-hosting (#193)
- Delegate chat answer generation to local agent (#186)

### Fixed
- Emit repo-analyzed event from all analysis trigger paths (#200)
- Improved re-review scoring and resolved findings tracking (#197)
- Sanitize semicolons in Mermaid and skip diagrams for docs PRs (#196)
- Reduce false positives in review engine prompt and validation (#188)
- Correct domain and page URLs in Ask Octopus system prompt
- Fallback to /files endpoint when GitHub returns 406 on large diffs

## [1.0.10] - 2026-04-06

### Added
- Incremental indexing on PR merge (#181)
- Stale index warning in chat context (#183)
- Support @octopusreview mention variant in webhooks (#174)

### Fixed
- Atomic index claim to prevent duplicate indexing (#182)
- Prevent duplicate review processing with atomic claim (#175)
- Persist credit-low email cooldown in database (#167)
- Show raw numbers for landing page stats (#168)

## [1.0.9] - 2026-04-04

### Added
- Bug Bounty page (#136)
- Landing page stats with real-time updates (#158)
- Pagination to admin jobs page (#146)
- Stale index support in repositories UI with status filter dropdown (#143)
- Session-aware CTA button to docs header (#134)
- diffFields audit utility for field-level change tracking (#153)

### Fixed
- Duplicate review guard now includes pending status (#162)
- Sanitize Mermaid state diagram notes and descriptions (#148)
- ObfuscatedEmail polymorphic tag to avoid nested anchor elements (#145)
- Top loader stuck on hash navigation and fast query param changes (#144)
- Handle PR synchronize events and post neutral check runs for blocked authors (#142)

### Changed
- Reduce false positives and improve review validation (#152)
- Migrate confidence scoring from string to numeric 0-100 scale (#131)
- Use Cloudflare geolocation headers instead of async IP lookup (#130)
- Improve Ask Octopus chat mobile UX (#159)

## [1.0.8] - 2026-04-02

### Added
- CLI quick install section with bash/PowerShell installer scripts (#115)
- Claude Code integration docs page and footer branding
- Review processing moved to pg-boss queue with admin-configurable settings (#123)
- Auto-detect OS to pre-select CLI install platform tab
- AI provider logos to hero section
- Server ID to version endpoint (#129)
- Nginx reverse proxy config for web/review-engine routing (#127)

### Fixed
- CLI installer scripts now download .tar.gz archives instead of raw binaries
- Install scripts with tmpdir fix, tty prompt, and no-sudo default
- Cohere logo height alignment with other provider logos (#128)
- Docs path references and Windows CLI install command

## [1.0.7] - 2026-04-01

### Added
- Landing page overhaul with bento grid features, FAQ accordion, and Review Engine animation (#108)
- Email template system with database-driven templates, Resend integration, and pg-boss job queue (#109)
- Admin UI for email template management with AI-powered generation and bulk sending (#109)
- Session management page with active session list, device tracking, and revoke actions (#110)
- Knowledge base templates for one-click content creation with 8 pre-built templates (#111)
- Marketing email opt-out toggle in notification settings (#109)
- Rotating hero text animation on landing page (#99)

### Fixed
- Middleware redirect poisoning via X-Forwarded-Host header replaced with explicit URL config (#113)

### Changed
- Org switcher redesigned with searchable dropdown and colored avatars (#112)
- User menu revamped with view-switching pattern and sign-out confirmation (#112)
- Sidebar chat button repositioned with improved styling (#112)
- Review helpers extracted into separate module with unit tests (#100)

## [1.0.6] - 2026-03-29

### Added
- Changelog docs page with timeline UI, colored section cards, and PR links (#93)
- CODEOWNERS for automated review assignment (#94)
- Octopus Changelog skill for automated CHANGELOG.md updates (#95)

### Fixed
- Mobile navbar logo now navigates to home page (#96)
- React/react-dom version mismatch (19.2.3 → 19.2.4) (#96)

## [1.0.5] - 2026-03-29

### Added
- Status page system with public and admin interfaces, real-time updates via Pubby (#81)
- Audit logging system with admin UI and event observers (#82)
- Organization types (Standard/Community/Friendly) and community program management (#83)
- Review pipeline: cancel stuck reviews, local review API, GitHub Action endpoint, review simulator (#84)
- Chat repo context, multi-language translation, sidebar rename to "Ask Octopus" (#85)
- Billing: credit-low alerts, GitHub Marketplace webhook, usage page credit banner (#86)
- Linear auth error handling with reconnect UX
- CLI auto-org creation for new users

### Fixed
- CI lint errors and TypeScript type inference issues (#88)
- Escape user-controlled strings in email HTML templates (#87)

### Changed
- README branding image updated (#74)

## [1.0.4] - 2026-03-27

### Added
- Chat button on repository detail page (#70)

### Fixed
- Dedup now covers summary table findings, not just inline comments
- Apply period/repo/author filters to Issues by Severity on dashboard

### Changed
- UI improvements across landing page, brand assets, and settings (#69)

## [1.0.3] - 2026-03-26

### Added
- Local agent infrastructure and Ask Octopus public AI chat (#60)
- Email notification settings (#54)
- Blog system with admin CRUD, public pages, and search (#59)
- Brand guidelines page and Resources nav dropdown (#53)

### Fixed
- Review engine: critical findings visibility, empty diagrams, and false positive reduction (#67)
- Brand page typography section responsive on mobile

### Changed
- Review engine improvements, Bitbucket clone indexing, and UI enhancements (#58)
- CLI moved to separate repository

## [1.0.2] - 2026-03-24

### Fixed
- Sanitize escaped quotes in mermaid node labels (#51)

## [1.0.1] - 2026-03-24

### Added
- Package analyzer UI, API routes, and admin panel (#44)
- Package analyzer library for npm dependency security scanning (#43)
- Getting started, glossary, and skills documentation pages (#46)

### Changed
- Landing page UI updates and styling improvements (#47)

## [1.0.0] - 2026-03-24

### Added
- Onboarding tips on dashboard
- SEO metadata, OG tags, sitemap, robots.txt, and llms.txt
- Block specific PR authors from triggering reviews (#27)
- Dim unicorn 3D scene on text selection (#16)
- Social links and Product Hunt badge to landing footer (#15)
- Discord and LinkedIn links to landing footer (#31)
- Comprehensive unit test suite for core libraries (#37)

### Fixed
- Findings summary regex matches full table including separator rows
- Preserve review summary/score on re-review, only replace findings table
- Re-review filter updates main comment and findings count
- Per-finding feedback parsing, emoji recognition, and inline comment dedup (#33)
- Reset indexing status when abort controller is missing (#30)
- Suppress dismissed findings in Additional findings summary (#25)
- CI lint failures across all packages (#36)

[1.0.26]: https://github.com/octopusreview/octopus/compare/v1.0.25...v1.0.26
[1.0.25]: https://github.com/octopusreview/octopus/compare/v1.0.24...v1.0.25
[1.0.24]: https://github.com/octopusreview/octopus/compare/v1.0.23...v1.0.24
[1.0.23]: https://github.com/octopusreview/octopus/compare/v1.0.19...v1.0.23
[1.0.19]: https://github.com/octopusreview/octopus/compare/v1.0.18...v1.0.19
[1.0.18]: https://github.com/octopusreview/octopus/compare/v1.0.17...v1.0.18
[1.0.17]: https://github.com/octopusreview/octopus/compare/v1.0.16...v1.0.17
[1.0.16]: https://github.com/octopusreview/octopus/compare/v1.0.15...v1.0.16
[1.0.15]: https://github.com/octopusreview/octopus/compare/v1.0.14...v1.0.15
[1.0.14]: https://github.com/octopusreview/octopus/compare/v1.0.13...v1.0.14
[1.0.13]: https://github.com/octopusreview/octopus/compare/v1.0.12...v1.0.13
[1.0.12]: https://github.com/octopusreview/octopus/compare/v1.0.11...v1.0.12
[1.0.11]: https://github.com/octopusreview/octopus/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/octopusreview/octopus/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/octopusreview/octopus/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/octopusreview/octopus/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/octopusreview/octopus/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/octopusreview/octopus/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/octopusreview/octopus/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/octopusreview/octopus/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/octopusreview/octopus/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/octopusreview/octopus/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/octopusreview/octopus/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/octopusreview/octopus/releases/tag/v1.0.0
