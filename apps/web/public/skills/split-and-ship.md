---
allowed-tools: Bash(git:*), Bash(gh:*), Read, Edit, Write, Glob, Grep
description: Analyze, categorize, and ship all your changes as separate PRs
---

# Split and Ship

Analyze all current changes in the working tree, categorize them, create GitHub issues, and ship each category as a separate PR.

## Instructions

Follow these steps carefully and in order:

### Step 1: Analyze Changes

1. Run `git status` and `git diff` (both staged and unstaged) to see all modifications.
2. Run `git diff --name-only HEAD` and `git ls-files --others --exclude-standard` to get the full list of changed and untracked files.
3. Read the relevant changed files to understand what each change does.

### Step 2: Categorize Changes

Group the changed files into logical categories based on what they do. Examples of categories:
- A new feature (e.g., "Add multi-prompt field component")
- A bug fix (e.g., "Fix credit calculation in generate API")
- A refactor (e.g., "Refactor provider factory for failover support")
- Translation updates (e.g., "Update i18n translations for new features")

Each category should be a coherent, independently shippable unit of work. Present the categories to the user and get confirmation before proceeding.

### Step 3: Create GitHub Issues

For each category, create a GitHub issue using `gh issue create`:
- Title: Clear, descriptive title for the category
- Body: Description listing the files and summarizing the changes
- Labels: Use appropriate labels (e.g., `enhancement`, `bug`, `refactor`)

Record each created issue number. You will need it for branch names and PR references.

### Step 4: For Each Issue, Create Branch, Commit, Push, and Open PR

Remember the current branch name before starting. For each issue/category:

1. **Start from the base branch**: `git checkout master && git pull origin master`
2. **Create a new branch** using conventional naming: `git checkout -b <type>/<short-description>` where type is `feat`, `fix`, `refactor`, `chore`, `docs`, etc.
3. **Stage only the files belonging to this category**: `git add <file1> <file2> ...`
4. **Commit** with a descriptive message referencing the issue.
5. **Push** the branch: `git push -u origin <branch-name>`
6. **Create a PR** using `gh pr create` with a summary and `Closes #<issue-number>`.

### Step 5: Return to Original Branch

After all PRs are created, checkout back to the branch the user was originally on.

### Step 6: Report Summary

Print a summary table showing:
- Category name
- Issue number (e.g., #42)
- Branch name
- PR URL
- Number of files in that category

## Important Rules

- Branch names must follow conventional naming: `<type>/<short-kebab-case-description>`
- Each category must be independently committable. No file should appear in multiple categories.
- If a file logically belongs to multiple categories, ask the user which category it should go in.
- Always confirm the categorization with the user before creating issues and branches.
- If there are no changes to categorize, inform the user and stop.
