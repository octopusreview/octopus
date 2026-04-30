# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Knowledge Center: pin documents to always include in every review, regardless of diff similarity (#317)

### Fixed
- Snap findings whose line range partially misses the diff onto the nearest changed line within ±10 lines, with a small note. Previously high-severity findings could drop to the summary table even when the change was within reach. (#321)
- Show "✅ No new issues detected since the last review" on re-reviews with zero findings, instead of leaving the comment looking empty. (#321)

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
