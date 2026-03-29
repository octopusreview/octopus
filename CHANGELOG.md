# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.5]: https://github.com/octopusreview/octopus/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/octopusreview/octopus/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/octopusreview/octopus/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/octopusreview/octopus/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/octopusreview/octopus/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/octopusreview/octopus/releases/tag/v1.0.0
