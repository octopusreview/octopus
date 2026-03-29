---
allowed-tools: Bash(git:*), Bash(gh:*), Read, Edit, Glob, Grep
description: Update CHANGELOG.md for a new release based on git history
---

# Changelog Update

Update CHANGELOG.md for a new release using the Keep a Changelog standard.

## Instructions

### Step 1: Determine Version

1. If the user provided a version as argument `$ARGUMENTS`, use that.
2. Otherwise, get the latest tag: `git tag -l | sort -V | tail -1`
3. Suggest the next patch version (e.g., v1.0.5 → v1.0.6) and ask the user to confirm or specify a different version.

### Step 2: Gather Commits

1. Get all commits since the latest tag:
   ```
   git log --format="%s" <latest-tag>..HEAD
   ```
2. Get today's date for the release header.
3. If there are no new commits since the last tag, inform the user and stop.

### Step 3: Categorize Changes

Parse each commit message and categorize using conventional commit prefixes:

- `feat:` → **Added**
- `fix:` → **Fixed**
- `refactor:` / `perf:` → **Changed**
- `docs:` → Skip (unless significant)
- `chore:` / `ci:` / `test:` → Skip (unless user-facing)
- `chore(deps):` / `chore(deps-dev):` → Skip entirely (dependency bumps)
- Breaking changes → **Breaking Changes** (look for `BREAKING CHANGE` or `!:`)

Rules:
- Merge/squash commits that describe the same feature into one entry
- Write entries from the user's perspective, not the developer's
- Include PR numbers in parentheses when available, e.g., (#42)
- Remove commit prefixes (feat:, fix:, etc.) from the final text
- Keep entries concise — one line each
- Skip trivial changes (typo fixes, minor refactors, dependency bumps)

### Step 4: Present Draft

Show the categorized entries to the user for review before writing:

```
## [X.Y.Z] - YYYY-MM-DD

### Added
- ...

### Fixed
- ...

### Changed
- ...
```

Ask the user to confirm, modify, or add/remove entries.

### Step 5: Update CHANGELOG.md

1. Read the current CHANGELOG.md
2. Insert the new version section after the header (below the "and this project adheres to..." line) and before the previous version
3. Add the comparison link at the bottom of the file:
   ```
   [X.Y.Z]: https://github.com/octopusreview/octopus/compare/vPREVIOUS...vX.Y.Z
   ```
4. Update the previous version's link if it pointed to `HEAD`

### Step 6: Summary

Show what was added to CHANGELOG.md and remind the user to:
- Review the changes
- Commit and tag when ready

## Important Rules

- **Never commit or push** — only update the file. The user will commit when ready.
- **Always show the draft first** and get confirmation before writing.
- **Use Keep a Changelog format** exactly — headers are `### Added`, `### Fixed`, `### Changed`, `### Removed`, `### Deprecated`, `### Security`.
- **Skip dependency bumps** (Dependabot PRs, `chore(deps):` commits).
- **Group related commits** — multiple commits for the same feature become one entry.
- **Be concise** — one line per entry, written for end users.
