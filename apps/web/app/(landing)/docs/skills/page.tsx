import {
  IconWand,
  IconGitPullRequest,
  IconCategory,
  IconGitBranch,
  IconReportAnalytics,
  IconArrowsSplit,
  IconBugOff,
} from "@tabler/icons-react";
import { SkillCodeBlock } from "./skill-code-block";
import { SkillCard } from "./skill-card";

export const metadata = {
  title: "Skills | Octopus Docs",
  description:
    "AI-powered automation skills that streamline your development workflow, from code review to shipping PRs, fully automated.",
};

export default function SkillsPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconWand className="size-4" />
          Skills
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Automate Your Entire Review
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          Skills are reusable AI-powered workflows that handle the repetitive
          parts of your development cycle, categorize changes, create issues,
          open PRs, and ship code, all fully automated.
        </p>
      </div>

      {/* What are Skills */}
      <Section title="What are Skills?">
        <Paragraph>
          Each skill encapsulates a multi-step workflow that would otherwise
          require manual effort, context switching, and coordination across
          tools. Instead of sorting through diffs, writing commit messages, and
          opening PRs one by one. Let AI handle it.
        </Paragraph>
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <FeatureCard
            icon={<IconCategory className="size-4" />}
            title="Smart Categorization"
            description="AI analyzes your changes and groups them into logical, shippable units."
          />
          <FeatureCard
            icon={<IconGitPullRequest className="size-4" />}
            title="Auto PR Creation"
            description="Each category becomes a separate PR with proper branching and issue linking."
          />
          <FeatureCard
            icon={<IconReportAnalytics className="size-4" />}
            title="Full Traceability"
            description="Every PR references a GitHub issue. Nothing gets lost in the process."
          />
        </div>
      </Section>

      {/* Skills */}
      <Section title="Available Skills">
        {/* Skill: Split and Ship */}
        <SkillCard
          icon={<IconArrowsSplit className="size-5" />}
          title="Split and Ship"
          subtitle="Analyze, categorize, and ship all your changes as separate PRs"
          filename="split-and-ship.md"
          content={SPLIT_AND_SHIP_MD}
        >
          <Paragraph>
            You&apos;ve been working on multiple things at once. Your working
            tree has a mix of features, fixes, and refactors. Instead of
            manually sorting, committing, and opening PRs one by one, Split and
            Ship handles the entire flow automatically.
          </Paragraph>

          <SubHeading>How it works</SubHeading>
          <div className="mb-6 space-y-3">
            <StepCard
              step={1}
              title="Analyze"
              description="Scans git status, diffs, and untracked files to understand every change in your working tree."
            />
            <StepCard
              step={2}
              title="Categorize"
              description="Groups files into logical, independently shippable units (features, bug fixes, refactors) and presents them for your approval."
            />
            <StepCard
              step={3}
              title="Create Issues"
              description="Opens a GitHub issue for each category with a clear description and appropriate labels."
            />
            <StepCard
              step={4}
              title="Ship PRs"
              description="For each category: creates a branch, commits only the relevant files, pushes, and opens a PR that closes the corresponding issue."
            />
            <StepCard
              step={5}
              title="Report"
              description="Prints a summary table with issue numbers, branch names, PR URLs, and file counts."
            />
          </div>

          <SubHeading>Branch naming</SubHeading>
          <Paragraph>
            Follows conventional naming:{" "}
            <Code>{"<type>/<short-description>"}</Code> where type is{" "}
            <Code>feat</Code>, <Code>fix</Code>, <Code>refactor</Code>,{" "}
            <Code>chore</Code>, or <Code>docs</Code>.
          </Paragraph>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <BranchExample name="feat/multi-prompt-field" />
            <BranchExample name="fix/credit-calculation" />
            <BranchExample name="refactor/provider-factory" />
          </div>

          <SubHeading>Rules</SubHeading>
          <ul className="mb-6 space-y-2">
            <RuleItem text="Each file belongs to exactly one category, no overlaps." />
            <RuleItem text="Categories are confirmed by you before any issues or PRs are created." />
            <RuleItem text="Every PR references and closes its corresponding GitHub issue." />
            <RuleItem text="If a file logically belongs to multiple categories, you'll be asked to decide." />
          </ul>

          <SubHeading>Skill file</SubHeading>
          <Paragraph>
            Copy or download the markdown file below and add it to your project
            to use this skill with Claude Code.
          </Paragraph>
          <SkillCodeBlock
            title="split-and-ship.md"
            filename="split-and-ship.md"
          >
            {SPLIT_AND_SHIP_MD}
          </SkillCodeBlock>
        </SkillCard>

        {/* Skill: Octopus Fix */}
        <SkillCard
          icon={<IconBugOff className="size-5" />}
          title="Octopus Fix"
          subtitle="Check open PRs for review comments, apply fixes, and push updates"
          filename="octopus-fix.md"
          content={OCTOPUS_FIX_MD}
        >
          <Paragraph>
            After Octopus reviews your PRs, this skill checks all open PRs for
            pending review comments and requested changes. It analyzes the
            feedback, applies the necessary fixes, and pushes the updates
            automatically.
          </Paragraph>

          <SubHeading>How it works</SubHeading>
          <div className="mb-6 space-y-3">
            <StepCard
              step={1}
              title="Discover Open PRs"
              description="Lists all open PRs authored by you and checks their review status."
            />
            <StepCard
              step={2}
              title="Check Reviews"
              description="Fetches review comments, inline suggestions, and conversation threads for each PR."
            />
            <StepCard
              step={3}
              title="Present Summary"
              description="Shows each review comment with the proposed fix and asks for your confirmation before making changes."
            />
            <StepCard
              step={4}
              title="Apply Fixes"
              description="Checks out each PR branch, applies the minimal changes to address feedback, commits, and pushes."
            />
            <StepCard
              step={5}
              title="Report"
              description="Prints a summary table with PR numbers, comments addressed, and what was changed."
            />
          </div>

          <SubHeading>Review handling</SubHeading>
          <ul className="mb-6 space-y-2">
            <RuleItem text="Valid suggestions get a thumbs up reaction and are fixed with a reply describing the change." />
            <RuleItem text="False positives get a thumbs down reaction with an explanation." />
            <RuleItem text="Review threads are resolved after fixes are applied." />
            <RuleItem text="A final PR comment tags @octopus to notify that updates are ready." />
          </ul>

          <SubHeading>Rules</SubHeading>
          <ul className="mb-6 space-y-2">
            <RuleItem text="Never force-push. Always use regular git push." />
            <RuleItem text="Always show proposed fixes and get confirmation before committing." />
            <RuleItem text="Make minimal changes. Only fix what the reviewer asked for." />
            <RuleItem text="If a review comment is unclear, ask the user rather than guessing." />
            <RuleItem text="If there are merge conflicts, inform the user and stop." />
            <RuleItem text="Preserve existing commit history. No squash, rebase, or amend." />
          </ul>

          <SubHeading>Skill file</SubHeading>
          <Paragraph>
            Copy or download the markdown file below and add it to your project
            to use this skill with Claude Code.
          </Paragraph>
          <SkillCodeBlock
            title="octopus-fix.md"
            filename="octopus-fix.md"
          >
            {OCTOPUS_FIX_MD}
          </SkillCodeBlock>
        </SkillCard>
      </Section>

      {/* More skills coming */}
      <Section title="More Skills Coming Soon">
        <Paragraph>
          We&apos;re building more automation skills to cover the entire
          development lifecycle, from automated test generation to release
          management. Have an idea for a skill? Open an issue on GitHub.
        </Paragraph>
      </Section>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Skill markdown content                                              */
/* ------------------------------------------------------------------ */

const SPLIT_AND_SHIP_MD = `# Split and Ship

Analyze all current changes in the working tree, categorize them, create GitHub issues, and ship each category as a separate PR.

## Instructions

Follow these steps carefully and in order:

### Step 1: Analyze Changes

1. Run \`git status\` and \`git diff\` (both staged and unstaged) to see all modifications.
2. Run \`git diff --name-only HEAD\` and \`git ls-files --others --exclude-standard\` to get the full list of changed and untracked files.
3. Read the relevant changed files to understand what each change does.

### Step 2: Categorize Changes

Group the changed files into logical categories based on what they do. Examples of categories:
- A new feature (e.g., "Add multi-prompt field component")
- A bug fix (e.g., "Fix credit calculation in generate API")
- A refactor (e.g., "Refactor provider factory for failover support")
- Translation updates (e.g., "Update i18n translations for new features")

Each category should be a coherent, independently shippable unit of work. Present the categories to the user and get confirmation before proceeding.

### Step 3: Create GitHub Issues

For each category, create a GitHub issue using \`gh issue create\`:
- Title: Clear, descriptive title for the category
- Body: Description listing the files and summarizing the changes
- Labels: Use appropriate labels (e.g., \`enhancement\`, \`bug\`, \`refactor\`)

Record each created issue number. You will need it for branch names and PR references.

### Step 4: For Each Issue, Create Branch, Commit, Push, and Open PR

Remember the current branch name before starting. For each issue/category:

1. **Start from the base branch**: \`git checkout master && git pull origin master\`
2. **Create a new branch** using conventional naming: \`git checkout -b <type>/<short-description>\` where type is \`feat\`, \`fix\`, \`refactor\`, \`chore\`, \`docs\`, etc.
3. **Stage only the files belonging to this category**: \`git add <file1> <file2> ...\`
4. **Commit** with a descriptive message referencing the issue.
5. **Push** the branch: \`git push -u origin <branch-name>\`
6. **Create a PR** using \`gh pr create\` with a summary and \`Closes #<issue-number>\`.

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

- Branch names must follow conventional naming: \`<type>/<short-kebab-case-description>\`
- Each category must be independently committable. No file should appear in multiple categories.
- If a file logically belongs to multiple categories, ask the user which category it should go in.
- Always confirm the categorization with the user before creating issues and branches.
- If there are no changes to categorize, inform the user and stop.
`.trim();

const OCTOPUS_FIX_MD = `---
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

Once all fixes are applied and pushed, post a final PR comment tagging @octopus to notify it that the updates are ready for review.

## Instructions

Follow these steps carefully and in order:

### Step 1: Discover Open PRs

1. Save the current branch name: \`git branch --show-current\`
2. List open PRs authored by the current user:
   \`\`\`
   gh pr list --author "@me" --state open --json number,title,headRefName,reviewDecision,url
   \`\`\`
3. If no open PRs exist, inform the user and stop.
4. Display the list of open PRs with their review status to the user.

### Step 2: Check Reviews for Each PR

For each open PR (or a specific PR if the user provided a number as argument \`$ARGUMENTS\`):

1. Fetch review comments and review threads:
   \`\`\`
   gh pr view <number> --json reviews,reviewRequests,comments,title,headRefName,url
   gh api repos/{owner}/{repo}/pulls/<number>/comments --jq '.[] | {id, path, line, body, user: .user.login, created_at}'
   gh api repos/{owner}/{repo}/pulls/<number>/reviews --jq '.[] | {id, state, body, user: .user.login}'
   \`\`\`
2. Also check for inline review comments (conversation threads):
   \`\`\`
   gh pr view <number> --comments --json comments
   \`\`\`
3. Filter for actionable feedback:
   - Reviews with state \`CHANGES_REQUESTED\`
   - Unresolved review comments (inline code suggestions, requested changes)
   - General PR comments that contain action items
4. Skip PRs that have no actionable feedback (state is \`APPROVED\` or no reviews).

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

**Ask the user to confirm** which reviews to address before proceeding.

### Step 4: Apply Fixes

For each confirmed PR:

1. **Checkout the PR branch**:
   \`\`\`
   git checkout <branch-name> && git pull origin <branch-name>
   \`\`\`
2. **Read the relevant files** mentioned in the review comments.
3. **Apply the requested changes**:
   - For code suggestions: apply the suggested code change exactly
   - For style/refactor requests: make the minimal change that addresses the feedback
   - For bug reports: fix the bug as described
   - For questions/clarifications: if a code change is needed, make it; otherwise note it for the summary
4. **Stage and commit** the fixes:
   \`\`\`
   git add <changed-files>
   git commit -m "fix: address review feedback on #<PR-number>

   <bullet list of changes made in response to reviews>
   "
   \`\`\`
5. **Push** the changes:
   \`\`\`
   git push origin <branch-name>
   \`\`\`

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

- **Never force-push**. Always use regular \`git push\`.
- **Always show the proposed fixes to the user** and get confirmation before committing.
- **Make minimal changes**. Only fix what the reviewer asked for, do not refactor surrounding code.
- **If a review comment is unclear or ambiguous**, present it to the user and ask how to proceed rather than guessing.
- **If the review is just a question** (no code change needed), note it in the summary but don't make unnecessary changes.
- **If there are merge conflicts** when pulling the branch, inform the user and stop. Do not attempt to resolve conflicts automatically.
- **Preserve the existing commit history**. Do not squash, rebase, or amend existing commits.
`.trim();

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-[0.15em] text-[#555]">
      {children}
    </h3>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-white">
      {children}
    </code>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#888]">
        {icon}
      </div>
      <h4 className="text-sm font-medium text-white">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-[#666]">{description}</p>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs font-bold text-white">
        {step}
      </div>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[#666]">
          {description}
        </div>
      </div>
    </div>
  );
}

function BranchExample({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <IconGitBranch className="size-3.5 shrink-0 text-[#555]" />
      <code className="text-xs text-[#888]">{name}</code>
    </div>
  );
}

function RuleItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-sm text-[#888]">
      <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-white/20" />
      {text}
    </li>
  );
}
