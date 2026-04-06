---
allowed-tools: Bash(git:*), Bash(gh:*), Read, Edit, Write, Glob, Grep
description: Check open PRs for review comments, apply fixes, and push updates
---

# Octopus Fix

Review all open PRs for pending reviews and requested changes from Octopus Review bot. Apply the necessary fixes, commit them, and push the updates.

Rules:
- Ignore false-positive feedback.
- For each false positive, react to the comment with 👎 and explain.
- For each valid and useful suggestion, react to the comment with 👍.
- After fixing a valid issue, reply in the relevant review thread with a brief note describing the fix.
- Resolve the thread/conversation after replying, if resolving is supported.
- If thread resolution is not supported, leave a reply clearly stating that the issue has been addressed.
- **Score improvement:** After fixing all findings, check the Octopus Review bot's Score table in the PR summary (categories: Security, Code Quality, Performance, Error Handling, Consistency, Overall). For any category scoring below 4/5, analyze the Notes to understand what is dragging the score down, then make targeted improvements to bring those categories to at least 4/5. Do not touch categories already at 4/5 or 5/5.

Once all fixes are applied and pushed, post a final PR comment tagging @octopusreview to notify it that the updates are ready for review.

## Instructions

Follow these steps carefully and in order:

### Step 1: Discover Open PRs

1. Save the current branch name: `git branch --show-current`
2. List open PRs authored by the current user:
   ```
   gh pr list --author "@me" --state open --json number,title,headRefName,reviewDecision,url
   ```
3. If no open PRs exist, inform the user and stop.
4. Display the list of open PRs with their review status to the user.

### Step 2: Check Reviews for Each PR

For each open PR (or a specific PR if the user provided a number as argument `$ARGUMENTS`):

1. Fetch review comments and review threads:
   ```
   gh pr view <number> --json reviews,reviewRequests,comments,title,headRefName,url
   gh api repos/{owner}/{repo}/pulls/<number>/comments --jq '.[] | {id, path, line, body, user: .user.login, created_at}'
   gh api repos/{owner}/{repo}/pulls/<number>/reviews --jq '.[] | {id, state, body, user: .user.login}'
   ```
2. Also check for inline review comments (conversation threads):
   ```
   gh pr view <number> --comments --json comments
   ```
3. **Check if the latest Octopus Review bot review has 0 findings:**
   - Look at the most recent review/comment from the bot (user login containing "octopus" or "[bot]")
   - If the latest bot comment contains "0 findings" (e.g., "5 files reviewed, 0 findings"), this means all previous issues have been resolved
   - In this case, **skip this PR entirely** - there is nothing to fix. Inform the user: "PR #X: Latest review shows 0 findings - all issues resolved, skipping."
4. Filter for actionable feedback:
   - Reviews with state `CHANGES_REQUESTED`
   - Unresolved review comments (inline code suggestions, requested changes)
   - General PR comments that contain action items
5. Skip PRs that have no actionable feedback (state is `APPROVED` or no reviews).

### Step 3: Present Review Summary

Before making any changes, present a summary to the user:

For each PR with actionable feedback, show:
- PR title and number
- Branch name
- Reviewer(s) who requested changes
- List of each review comment with:
  - File path and line number (if inline)
  - The comment text
  - Your proposed fix or action
- **Score table analysis:** Show the current Octopus Review Score table and highlight any categories below 4/5. For each low-scoring category, explain what the Notes say and propose specific code changes to improve the score.

**Ask the user to confirm** which reviews to address before proceeding.

### Step 4: Apply Fixes

For each confirmed PR:

1. **Checkout the PR branch**:
   ```
   git checkout <branch-name> && git pull origin <branch-name>
   ```
2. **Read the relevant files** mentioned in the review comments.
3. **Apply the requested changes**:
   - For code suggestions: apply the suggested code change exactly
   - For style/refactor requests: make the minimal change that addresses the feedback
   - For bug reports: fix the bug as described
   - For questions/clarifications: if a code change is needed, make it; otherwise note it for the summary
4. **Improve low scores:** After addressing all review comments, look at the Octopus Review Score table. For each category below 4/5, make targeted fixes based on the Notes:
   - **Security** (< 4/5): Fix vulnerabilities, add input validation, sanitize data
   - **Code Quality** (< 4/5): Improve naming, reduce duplication, simplify logic
   - **Performance** (< 4/5): Optimize hot paths, fix unnecessary re-renders, reduce allocations
   - **Error Handling** (< 4/5): Add missing error handling, improve error messages, handle edge cases
   - **Consistency** (< 4/5): Align with existing patterns, fix naming inconsistencies, match project conventions
   - Keep changes minimal and focused on what the Score Notes specifically mention
5. **Stage and commit** the fixes:
   ```
   git add <changed-files>
   git commit -m "$(cat <<'EOF'
   fix: address review feedback on #<PR-number>

   <bullet list of changes made in response to reviews>

   EOF
   )"
   ````
6. **Push** the changes:
   ```
   git push origin <branch-name>
   ```

### Step 5: Return to Original Branch

After all fixes are pushed, checkout back to the branch the user was originally on.

### Step 6: Report Summary

Print a summary table showing:
- PR number and title
- Branch name
- Number of review comments addressed
- What was changed (brief description)
- PR URL

## Important Rules

- **Never use em dashes (—) in any text written to GitHub** (PR comments, commit messages, review replies). Use commas, periods, or semicolons instead.
- **Never force-push** - always use regular `git push`.
- **Always show the proposed fixes to the user** and get confirmation before committing.
- **Make minimal changes** - only fix what the reviewer asked for, do not refactor surrounding code.
- **If a review comment is unclear or ambiguous**, present it to the user and ask how to proceed rather than guessing.
- **If the review is just a question** (no code change needed), note it in the summary but don't make unnecessary changes.
- **If there are merge conflicts** when pulling the branch, inform the user and stop - do not attempt to resolve conflicts automatically.
- **Preserve the existing commit history** - do not squash, rebase, or amend existing commits.
